//! Serves the OpenTactics site and keeps a library of shared maps.
//!
//! The game needs no server: the site is static files and matches run browser
//! to browser. This program adds the one thing static hosting cannot do,
//! which is letting people publish maps from the editor.
//!
//!     opentactics-server [--bind 0.0.0.0:8080] [--site site] [--maps maps-user] [--no-uploads]
//!
//! GET /api/maps        every map: the bundled ones and the shared ones
//! GET /api/maps/{id}   one shared map
//! PUT /api/maps/{id}   publish a map (checked against the standard rules)

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use opentactics_core::{Game, MapDef, Rules};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::ServeDir;

const MAX_MAP_BYTES: usize = 256 * 1024;
const MAX_SHARED_MAPS: usize = 2000;

struct App {
    site: PathBuf,
    maps: PathBuf,
    uploads: bool,
}

#[tokio::main]
async fn main() {
    let mut bind = "0.0.0.0:8080".to_string();
    let mut site = PathBuf::from("site");
    let mut maps = PathBuf::from("maps-user");
    let mut uploads = true;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bind" => bind = args.next().expect("--bind needs an address"),
            "--site" => site = args.next().expect("--site needs a folder").into(),
            "--maps" => maps = args.next().expect("--maps needs a folder").into(),
            "--no-uploads" => uploads = false,
            other => {
                eprintln!("unknown option {other}\nusage: opentactics-server [--bind ADDR:PORT] [--site DIR] [--maps DIR] [--no-uploads]");
                std::process::exit(2);
            }
        }
    }
    if !site.join("index.html").exists() {
        eprintln!("{} has no index.html; run from the project folder or pass --site", site.display());
        std::process::exit(1);
    }
    let app = Arc::new(App { site: site.clone(), maps, uploads });
    let router = Router::new()
        .route("/api/maps", get(list_maps))
        .route("/api/maps/:id", get(get_map).put(put_map))
        .layer(DefaultBodyLimit::max(MAX_MAP_BYTES))
        .with_state(app)
        .fallback_service(ServeDir::new(site));
    let listener = tokio::net::TcpListener::bind(&bind).await.unwrap_or_else(|e| {
        eprintln!("cannot listen on {bind}: {e}");
        std::process::exit(1);
    });
    println!("OpenTactics is at http://{bind}/");
    axum::serve(listener, router).await.unwrap();
}

fn summary(id: &str, map: &Value, url: String, shared: bool) -> Value {
    json!({
        "id": id,
        "name": map["name"],
        "description": map["description"],
        "author": map["author"],
        "width": map["width"],
        "height": map["height"],
        "players": map["players"],
        "url": url,
        "shared": shared,
    })
}

async fn list_maps(State(app): State<Arc<App>>) -> Json<Value> {
    let mut list = vec![];
    if let Ok(text) = tokio::fs::read_to_string(app.site.join("maps/index.json")).await {
        if let Ok(Value::Array(bundled)) = serde_json::from_str(&text) {
            for m in bundled {
                let id = m["id"].as_str().unwrap_or_default().to_string();
                list.push(summary(&id, &m, format!("maps/{id}.json"), false));
            }
        }
    }
    let mut shared = vec![];
    if let Ok(mut dir) = tokio::fs::read_dir(&app.maps).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(id) = name.strip_suffix(".json") else { continue };
            let Ok(text) = tokio::fs::read_to_string(entry.path()).await else { continue };
            let Ok(map) = serde_json::from_str::<Value>(&text) else { continue };
            shared.push(summary(id, &map, format!("api/maps/{id}"), true));
        }
    }
    shared.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    list.extend(shared);
    Json(json!(list))
}

/// Map ids are short lowercase slugs, so they are safe as file names.
fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn refuse(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

async fn get_map(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
    if !valid_id(&id) {
        return refuse(StatusCode::BAD_REQUEST, "Bad map id.");
    }
    match tokio::fs::read(app.maps.join(format!("{id}.json"))).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "application/json")], bytes).into_response(),
        Err(_) => refuse(StatusCode::NOT_FOUND, "No such map."),
    }
}

async fn put_map(State(app): State<Arc<App>>, Path(id): Path<String>, body: Bytes) -> Response {
    if !app.uploads {
        return refuse(StatusCode::FORBIDDEN, "This server does not accept maps.");
    }
    if !valid_id(&id) {
        return refuse(StatusCode::BAD_REQUEST, "A map id is 1-40 lowercase letters, digits or dashes.");
    }
    let Ok(text) = std::str::from_utf8(&body) else {
        return refuse(StatusCode::BAD_REQUEST, "The map is not text.");
    };
    let map = match MapDef::from_json(text) {
        Ok(map) => map,
        Err(e) => return refuse(StatusCode::BAD_REQUEST, e),
    };
    // Maps made for the standard rules must actually start under them.
    // Maps that name their own rule set are only checked for shape.
    if map.rules.is_none() {
        let rules = match tokio::fs::read_to_string(app.site.join("rules/default.json")).await {
            Ok(text) => Rules::from_json(&text),
            Err(e) => Err(e.to_string()),
        };
        match rules {
            Ok(rules) => {
                if let Err(e) = Game::new(rules, &map, 1) {
                    return refuse(StatusCode::BAD_REQUEST, e);
                }
            }
            Err(e) => return refuse(StatusCode::INTERNAL_SERVER_ERROR, e),
        }
    } else if map.tiles.len() != map.height || map.tiles.iter().any(|r| r.chars().count() != map.width) {
        return refuse(StatusCode::BAD_REQUEST, "map: the rows do not match its size");
    }
    if tokio::fs::create_dir_all(&app.maps).await.is_err() {
        return refuse(StatusCode::INTERNAL_SERVER_ERROR, "Cannot store maps.");
    }
    let path = app.maps.join(format!("{id}.json"));
    if !path.exists() {
        let mut count = 0;
        if let Ok(mut dir) = tokio::fs::read_dir(&app.maps).await {
            while let Ok(Some(_)) = dir.next_entry().await {
                count += 1;
            }
        }
        if count >= MAX_SHARED_MAPS {
            return refuse(StatusCode::INSUFFICIENT_STORAGE, "The map library is full.");
        }
    }
    // Store it re-serialised, so only fields the game knows are kept.
    let clean = serde_json::to_string_pretty(&map).unwrap();
    match tokio::fs::write(&path, clean).await {
        Ok(()) => Json(json!({ "id": id, "url": format!("api/maps/{id}") })).into_response(),
        Err(_) => refuse(StatusCode::INTERNAL_SERVER_ERROR, "Cannot store the map."),
    }
}
