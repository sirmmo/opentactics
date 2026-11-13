// Translations. The game is written in English; this module translates what the
// page shows as it appears (text, titles, placeholders, dialogs), from a
// dictionary of exact strings and a list of patterns for sentences with names
// and numbers in them. Names inside those sentences (units, armies, terrain…)
// are translated too. To add a language, add a table like IT below.

const IT_WORDS = {
  // armies
  Red: 'Rosso', Blue: 'Blu', Green: 'Verde', Orange: 'Arancio', Purple: 'Viola', Pink: 'Rosa', Teal: 'Verde acqua', Yellow: 'Giallo',
  Navy: 'Blu notte', Sky: 'Celeste', Maroon: 'Granata', Lime: 'Lime', Brown: 'Marrone', Lavender: 'Lavanda', Olive: 'Oliva', Coral: 'Corallo',
  // units
  Infantry: 'Fanteria', Mech: 'Bazooka', Recon: 'Ricognitore', Tank: 'Carro armato', Artillery: 'Artiglieria', Rockets: 'Lanciarazzi',
  'Anti-air': 'Contraerea', Gunship: 'Elicottero da attacco', 'Strike jet': 'Caccia', 'Patrol boat': 'Motovedetta', Cruiser: 'Incrociatore',
  Battleship: 'Corazzata', Carrier: 'Mezzo di supporto', Airlift: 'Elitrasporto', Lander: 'Mezzo da sbarco', Submarine: 'Sottomarino',
  // terrain
  Plain: 'Pianura', Forest: 'Bosco', Mountain: 'Montagna', Road: 'Strada', Bridge: 'Ponte', Sea: 'Mare', City: 'Città', Factory: 'Fabbrica',
  Airport: 'Aeroporto', Port: 'Porto', Headquarters: 'Quartier generale', 'Comms tower': 'Torre radio', Beach: 'Spiaggia', Reef: 'Scogliera',
  // weather and powers
  Clear: 'Sereno', Rain: 'Pioggia', Snow: 'Neve', Blitz: 'Blitz', Fortify: 'Fortificare', 'Field repair': 'Riparazione sul campo',
  'War chest': 'Cassa di guerra', 'Eagle eye': "Occhio d'aquila", Standard: 'Standard',
  Player: 'Giocatore', Computer: 'Computer', Enemy: 'Nemico', Me: 'Io',
};

const IT = {
  ...IT_WORDS,
  // ---- menu and screens ----
  'Turn-based skirmish on a grid. Same army for everyone.': 'Battaglie a turni su una griglia. Lo stesso esercito per tutti.',
  Play: 'Gioca', 'Against the computer, or take turns on one screen': 'Contro il computer, o a turno sullo stesso schermo',
  Missions: 'Missioni', 'Tutorial and challenges, one step at a time': 'Addestramento e sfide, un passo alla volta',
  'Host online': 'Ospita online', 'Open a room and share its code': 'Apri una stanza e condividi il codice',
  'Join online': 'Unisciti online', 'Enter a friend’s room code': 'Inserisci il codice della stanza di un amico',
  'Map editor': 'Editor di mappe', 'Draw or generate maps, and make missions': 'Disegna o genera mappe, e crea missioni',
  'Rules editor': 'Editor delle regole', 'Change units, damage and money, and share your rules': 'Cambia unità, danni e denaro, e condividi le tue regole',
  'Load replay or save': 'Carica replay o salvataggio', 'Watch a recorded game, or carry on a saved one': 'Guarda una partita registrata, o riprendi una salvata',
  Settings: 'Impostazioni', 'Army symbols, text size, motion, sound and music': 'Simboli degli eserciti, testo, movimento, suoni e musica',
  'Art and sounds by Kenney (CC0). Online play goes browser to browser over WebRTC.': 'Grafica e suoni di Kenney (CC0). Il gioco online va da browser a browser via WebRTC.',
  '⤓ Install the app': '⤓ Installa l’app', 'Full screen, home-screen icon, plays offline against the computer': 'A schermo intero, con icona, gioca offline contro il computer',
  'To install: tap ': 'Per installare: tocca ', Share: 'Condividi', ' then ': ' poi ', 'Add to Home Screen': 'Aggiungi alla schermata Home',
  'Forget it': 'Lascia perdere', 'Loading…': 'Caricamento…', 'Loading maps…': 'Caricamento mappe…',
  '← Back': '← Indietro', '← Menu': '← Menu', Back: 'Indietro', Close: 'Chiudi', Cancel: 'Annulla', Done: 'Fatto', OK: 'OK',
  // ---- setup ----
  'New match': 'Nuova partita', 'Host an online match': 'Ospita una partita online', Start: 'Inizia', 'Start the match': 'Inizia la partita',
  Map: 'Mappa', Rules: 'Regole', Players: 'Giocatori', 'Add map from URL': 'Aggiungi mappa da URL', 'Load file': 'Carica file',
  'From a URL…': 'Da un URL…', 'From a file…': 'Da un file…', 'Optional rules': 'Regole facoltative', 'Choose a map first.': 'Prima scegli una mappa.',
  Human: 'Persona', 'This browser': 'Questo browser', 'Online player': 'Giocatore online', 'waiting…': 'in attesa…', 'open seat': 'posto libero',
  'Game mode': 'Modalità', 'King of the hill': 'Re della collina', 'Battle royale': 'Battle royale', 'Survival (co-op)': 'Sopravvivenza (cooperativa)', 'Score race': 'Corsa ai punti',
  'Take the enemy headquarters or wipe out their army.': 'Conquista il quartier generale nemico o distruggi il suo esercito.',
  'Also: hold the marked middle tile at the start of 3 days in a row.': 'In più: tieni la casella centrale segnata all’inizio di 3 giorni di fila.',
  'From day 5 a storm closes in on the middle and hurts units outside it.': 'Dal giorno 5 una tempesta si stringe verso il centro e danneggia chi resta fuori.',
  'Everyone not played by the computer is one team. The computer gets free waves of units; last until day 15.': 'Chi non è il computer fa squadra. Il computer riceve ondate di unità gratis; resistete fino al giorno 15.',
  'After 20 days the side with the most property wins.': 'Dopo 20 giorni vince chi ha più proprietà.',
  Diplomacy: 'Diplomazia', 'Offer alliances (shared vision, win together) and truces during the game.': 'Offri alleanze (vista condivisa, vittoria comune) e tregue durante la partita.',
  'Far players move at once': 'I giocatori lontani muovono insieme',
  'Players who cannot reach each other this round take their turns at the same time (teammates too). Everyone still plays once a day.': 'Chi non può raggiungersi in questo giro gioca il turno in contemporanea (anche i compagni di squadra). Ognuno gioca comunque una volta al giorno.',
  'Fog of war': 'Nebbia di guerra', 'You only see what your units and property see.': 'Vedi solo ciò che vedono le tue unità e proprietà.',
  'Fuel and ammo': 'Carburante e munizioni', 'Units run out; aircraft and ships are lost with empty tanks. Refill at your property or next to a carrier.': 'Le unità si esauriscono; aerei e navi a secco vanno perduti. Si riforniscono sulle tue proprietà o accanto a un mezzo di supporto.',
  Powers: 'Poteri', Weather: 'Meteo', 'Rain and snow slow units down.': 'Pioggia e neve rallentano le unità.', Off: 'No', 'Changes each day': 'Cambia ogni giorno',
  'Always clear': 'Sempre sereno', 'Always rain': 'Sempre pioggia', 'Always snow': 'Sempre neve',
  'No team': 'Nessuna squadra', Team: 'Squadra', Skill: 'Abilità', Style: 'Stile', Easy: 'Facile', Normal: 'Normale', Hard: 'Difficile',
  Balanced: 'Equilibrato', Rusher: 'Aggressivo', Turtle: 'Difensivo', Economist: 'Economo', easy: 'facile', normal: 'normale', hard: 'difficile',
  balanced: 'equilibrato', rusher: 'aggressivo', turtle: 'difensivo', economist: 'economo',
  Room: 'Stanza', 'Copy link': 'Copia link', Copy: 'Copia', Copied: 'Copiato', 'Turn timer': 'Tempo per turno', 'No time limit': 'Nessun limite',
  '1 minute a turn': '1 minuto a turno', '2 minutes a turn': '2 minuti a turno', '5 minutes a turn': '5 minuti a turno',
  'Opening a room…': 'Apertura della stanza…', 'Link to this map': 'Link a questa mappa', 'This mission sets its own rules.': 'Questa missione ha le sue regole.',
  'Friends open the link, or choose Join online and type the code. Seats set to “Online player” fill in the order people arrive; anyone else can watch. When a turn runs out of time it ends by itself.': 'Gli amici aprono il link, oppure scelgono Unisciti online e scrivono il codice. I posti “Giocatore online” si riempiono in ordine di arrivo; gli altri possono guardare. Un turno che esaurisce il tempo finisce da solo.',
  'Remove from this list': 'Togli da questa lista', 'URL of a map (JSON):': 'URL di una mappa (JSON):', 'URL of a rule set (JSON):': 'URL di un insieme di regole (JSON):',
  'Some online seats are still empty. Let the computer play them?': 'Alcuni posti online sono ancora vuoti. Li fai giocare al computer?',
  'Everyone is on one team: there would be nobody to fight.': 'Sono tutti nella stessa squadra: non ci sarebbe nessuno da combattere.',
  'Survival needs at least one computer seat (the invaders) and one person.': 'La sopravvivenza richiede almeno un posto del computer (gli invasori) e una persona.',
  'Survival makes its own teams: clear the team choices.': 'La sopravvivenza crea le sue squadre: togli le scelte di squadra.',
  // ---- joining ----
  'Join an online match': 'Unisciti a una partita online', 'Room code': 'Codice stanza', 'Your name': 'Il tuo nome', 'ROOM CODE': 'CODICE',
  'Just watch': 'Guarda soltanto', 'Follow the game without taking a seat.': 'Segui la partita senza occupare un posto.', Join: 'Unisciti',
  'Type the code the host shared.': 'Scrivi il codice che ti ha dato chi ospita.', 'Connecting…': 'Connessione…',
  'Connected. Waiting for the host to start…': 'Connesso. In attesa che chi ospita inizi…', 'The host closed the room.': 'Chi ospita ha chiuso la stanza.',
  'The host is choosing a map…': 'Chi ospita sta scegliendo la mappa…', 'The host gave your seat to someone else.': 'Chi ospita ha dato il tuo posto a qualcun altro.',
  ' All seats are taken; you will watch.': ' I posti sono tutti occupati: guarderai.', 'Disconnected from the host.': 'Disconnesso da chi ospita.',
  'Lost the host. Trying to reconnect…': 'Connessione persa. Provo a riconnettermi…', 'Back in the game.': 'Di nuovo in partita.',
  'Watching: everything is visible to you.': 'Stai guardando: vedi tutto.', Watching: 'Spettatore', 'You are watching this game.': 'Stai guardando questa partita.',
  // ---- battle screen ----
  'End turn': 'Fine turno', 'End turn (E)': 'Fine turno (E)', 'Wait…': 'Attendi…', 'Game over': 'Partita finita', Menu: 'Menu', Sound: 'Suono',
  'Zoom in': 'Ingrandisci', 'Zoom out': 'Rimpicciolisci', 'Next unit': 'Prossima unità', 'Next unit that has not moved (N)': 'Prossima unità non ancora mossa (N)',
  Log: 'Registro', 'Battle log': 'Registro di battaglia', Chat: 'Chat', 'Say something…': 'Scrivi qualcosa…', Send: 'Invia', All: 'Tutti', 'Send to': 'Invia a',
  'Map overview: click or drag to look around': 'Panoramica: clicca o trascina per guardarti intorno', 'Time left for this turn': 'Tempo rimasto per il turno',
  'Alliances and truces': 'Alleanze e tregue', 'Your turn. Pick a unit, or a factory you own to build. Right-click or Esc cancels; E ends the turn.': 'Tocca a te. Scegli un’unità, o una tua fabbrica per costruire. Tasto destro o Esc annulla; E termina il turno.',
  'Your turn. Tap a unit, or a factory you own to build. Tap outside the highlighted tiles to cancel.': 'Tocca a te. Tocca un’unità, o una tua fabbrica per costruire. Tocca fuori dalle caselle evidenziate per annullare.',
  'Sending…': 'Invio…', 'The game is over.': 'La partita è finita.', Fire: 'Fuoco', Capture: 'Conquista', Wait: 'Attendi', Board: 'Sali a bordo', Join_: 'Unisci',
  Unload: 'Scarica', Resupply: 'Rifornisci', Dive: 'Immergiti', Surface: 'Riemergi', 'Keep it on board': 'Lascialo a bordo', Neutral: 'Neutrale',
  'Every unit has moved.': 'Tutte le unità si sono mosse.', 'End turn anyway': 'Termina comunque', 'Show me': 'Mostrami', " Don't ask again": ' Non chiedere più',
  'Save game': 'Salva partita', Resign: 'Arrenditi', 'Resign this game?': 'Ti arrendi?', 'Leave to menu': 'Torna al menu', 'Leave this game?': 'Lasci la partita?',
  'Leave this game? You can resume hosting it from the main menu.': 'Lasci la partita? Puoi riprendere a ospitarla dal menu principale.',
  'Computer takes empty seats': 'Il computer prende i posti vuoti', 'Music: on': 'Musica: sì', 'Music: off': 'Musica: no',
  "Other players' moves: Normal": 'Mosse degli altri: normali', "Other players' moves: Fast": 'Mosse degli altri: veloci', "Other players' moves: Instant": 'Mosse degli altri: istantanee',
  Stats: 'Statistiche', 'Watch replay': 'Guarda il replay', 'Save replay': 'Salva il replay', Draw: 'Pareggio', 'Mission complete': 'Missione compiuta', 'Mission failed': 'Missione fallita',
  'Show my side': 'Mostra la mia parte', 'Fog of war is on. Pass the device, then tap to see your side of the battle.': 'La nebbia di guerra è attiva. Passa il dispositivo, poi tocca per vedere la tua parte.',
  'Army value': 'Valore dell’esercito', Properties: 'Proprietà', Units: 'Unità', 'Income per day': 'Rendita al giorno',
  'Not enough turns were played to draw anything.': 'Non si è giocato abbastanza per disegnare qualcosa.',
  Ally: 'Alleato', 'At war': 'In guerra', 'Offer truce': 'Offri tregua', 'Offer alliance': 'Offri alleanza', 'Offer sent': 'Offerta inviata', Accept: 'Accetta', No: 'No',
  'Leave the alliance': 'Lascia l’alleanza', 'Leave your alliance?': 'Lasci l’alleanza?', 'offers an alliance': 'offre un’alleanza',
  'Allies share what they see, cannot fight each other, and win together. A truce stops attacks and captures for a few days. You can do this at any time.': 'Gli alleati condividono ciò che vedono, non possono combattersi e vincono insieme. Una tregua ferma attacchi e conquiste per qualche giorno. Puoi farlo in qualsiasi momento.',
  'Charge comes from damage you deal (and half of what you take). One power at a time; it lasts until your next turn.': 'La carica viene dai danni che infliggi (e metà di quelli che subisci). Un potere alla volta; dura fino al tuo prossimo turno.',
  'The storm closes in': 'La tempesta si stringe', 'A wave arrives': 'Arriva un’ondata', 'More invaders are coming': 'Arrivano altri invasori',
  'Ambush!': 'Imboscata!', 'Captured!': 'Conquistato!', Supplied: 'Rifornito', Joined: 'Uniti', 'Something unseen': 'Qualcosa di invisibile',
  Objectives: 'Obiettivi', 'Restart mission': 'Ricomincia la missione', 'All missions': 'Tutte le missioni', 'Leave this mission?': 'Lasci la missione?',
  Tutorial: 'Addestramento', Challenges: 'Sfide', Completed: 'Completata',
  'Destroy every enemy unit': 'Distruggi tutte le unità nemiche', 'Keep at least one unit alive': 'Tieni in vita almeno un’unità', 'Lose all your units': 'Perdi tutte le tue unità',
  'Do not wipe out the enemy': 'Non annientare il nemico',
  'Watching a replay: everything is visible.': 'Stai guardando un replay: tutto è visibile.', Pause: 'Pausa', '▶ Play': '▶ Avvia', 'Download replay': 'Scarica il replay',
  Start_: 'Inizio', 'Back one': 'Indietro di una', 'Forward one': 'Avanti di una', End: 'Fine',
  'Days to win': 'Giorni per vincere',
  // unit card
  'Dived: hidden from enemies not next to it': 'Immerso: invisibile ai nemici non adiacenti',
  // ---- settings ----
  'Army symbols': 'Simboli degli eserciti', 'Each army also gets a shape on its units, buildings and name, for colour-blind players.': 'Ogni esercito ha anche una forma su unità, edifici e nome, per chi distingue male i colori.',
  'Text size': 'Dimensione del testo', 'Bigger text everywhere outside the board.': 'Testo più grande ovunque tranne che sul campo.', Large: 'Grande', Larger: 'Più grande',
  'Reduce motion': 'Riduci il movimento', 'No screen shake, bobbing, lunges, rain or water glints.': 'Niente scossoni, ondeggiamenti, scatti, pioggia o riflessi sull’acqua.',
  "Other players' moves": 'Mosse degli altri', 'How quickly computer and online moves play out.': 'Quanto velocemente si vedono le mosse del computer e degli altri.',
  Fast: 'Veloci', Instant: 'Istantanee', 'Interface and battle sounds.': 'Suoni dell’interfaccia e della battaglia.', Music: 'Musica',
  'A little chiptune, made in the browser.': 'Un piccolo motivo chiptune, creato nel browser.', Language: 'Lingua', 'The language of the game.': 'La lingua del gioco.', Automatic: 'Automatica',
  'Keyboard: arrow keys move the cursor, Enter or Space acts on that tile, Esc cancels, N picks the next unit, E ends the turn, + and − zoom.': 'Tastiera: le frecce muovono il cursore, Invio o Spazio agiscono sulla casella, Esc annulla, N sceglie la prossima unità, E termina il turno, + e − ingrandiscono.',
  // ---- editor ----
  New: 'Nuova', Generate: 'Genera', Open: 'Apri', Undo: 'Annulla', 'Undo (Ctrl+Z)': 'Annulla (Ctrl+Z)', Save: 'Salva', Download: 'Scarica', Publish: 'Pubblica', 'Test play': 'Prova',
  'Make a random fair map': 'Crea una mappa casuale ed equa', 'Map name': 'Nome della mappa', Author: 'Autore', Description: 'Descrizione', Terrain: 'Terreno',
  'Owner of buildings': 'Proprietario degli edifici', Mission: 'Missione', 'Paint freely': 'Dipingi liberamente', 'Also paint rotated 180°': 'Dipingi anche ruotato di 180°',
  'Also paint mirrored left ↔ right': 'Dipingi anche a specchio sinistra ↔ destra', 'Also paint mirrored top ↕ bottom': 'Dipingi anche a specchio alto ↕ basso',
  'Also paint in all four corners': 'Dipingi anche nei quattro angoli', '✓ Ready to play': '✓ Pronta per giocare', 'Remove units': 'Togli unità',
  'Name a unit (missions can refer to it by name)': 'Dai un nome a un’unità (le missioni possono riferirsi a lei)', 'Click a unit to name it.': 'Clicca un’unità per darle un nome.',
  'Left button paints, right button erases units. Pick a unit, then click. Maps can be any shape; the mirror options are only a drawing aid.': 'Il tasto sinistro dipinge, il destro cancella le unità. Scegli un’unità e poi clicca. Le mappe possono avere qualsiasi forma; lo specchio è solo un aiuto.',
  'Generate a map': 'Genera una mappa', Width: 'Larghezza', Height: 'Altezza', Water: 'Acqua', Mountains: 'Montagne', Forests: 'Boschi', 'Cities each': 'Città a testa', Seed: 'Seme',
  'New seed': 'Nuovo seme', 'Ring road': 'Strada ad anello', 'Extra factories': 'Fabbriche in più', Airports: 'Aeroporti', Ports: 'Porti', 'Comms towers': 'Torri radio',
  Beaches: 'Spiagge', Reefs: 'Scogliere', 'Use this map': 'Usa questa mappa', 'Mirrored exactly for every player.': 'Speculare per ogni giocatore.',
  'As even as a square grid allows.': 'Equa quanto lo permette una griglia quadrata.', none: 'nessuna', island: 'isola', lake: 'lago', rivers: 'fiumi',
  'island+lake': 'isola+lago', 'island+rivers': 'isola+fiumi', 'rivers+lake': 'fiumi+lago',
  'No playable map with these settings: try another seed or less water.': 'Nessuna mappa giocabile con queste scelte: prova un altro seme o meno acqua.',
  'Turn this map into a mission: a briefing, goals, and the computer playing the other seats.': 'Trasforma la mappa in una missione: un briefing, degli obiettivi e il computer agli altri posti.',
  'Make it a mission': 'Rendila una missione', 'Edit mission…': 'Modifica missione…', Remove: 'Togli', 'Remove the mission from this map?': 'Togli la missione da questa mappa?',
  Briefing: 'Briefing', 'The player is ': 'Il giocatore è ', ' Computer ': ' Computer ', 'Win when any of these is true': 'Vinci se una di queste è vera',
  'Lose when any of these is true': 'Perdi se una di queste è vera', Tips: 'Suggerimenti', '+ Goal': '+ Obiettivo', '+ Way to fail': '+ Sconfitta', '+ Tip': '+ Suggerimento',
  'Own the tile': 'Possedere la casella', 'Enemy owns the tile': 'Il nemico possiede la casella', 'Day reached': 'Giorno raggiunto', 'No enemy units left': 'Nessuna unità nemica',
  'No units of ours left': 'Nessuna nostra unità', 'Named unit is gone': 'L’unità nominata è perduta', 'Named unit is on the tile': 'L’unità nominata è sulla casella',
  'Pick on map': 'Scegli sulla mappa', 'Click the tile for this goal.': 'Clicca la casella per questo obiettivo.', 'Name a unit first (the Aa tool)': 'Prima dai un nome a un’unità (strumento Aa)',
  'Tip shown from that day': 'Suggerimento mostrato da quel giorno', 'Open a map': 'Apri una mappa', 'A bundled map…': 'Una mappa inclusa…', Untitled: 'Senza titolo',
  'Start a new, empty map? Unsaved changes are lost.': 'Iniziare una nuova mappa vuota? Le modifiche non salvate andranno perse.', 'That is not a map.': 'Questa non è una mappa.',
  // ---- rules editor ----
  'Start from': 'Parti da', 'Share link': 'Condividi link', 'Play with these': 'Gioca con queste', General: 'Generale', Damage: 'Danni', 'Everything (JSON)': 'Tutto (JSON)',
  Name: 'Nome', Money: 'Denaro', 'Starting funds': 'Fondi iniziali', 'Unit limit': 'Limite di unità', '0 = no limit': '0 = nessun limite', Combat: 'Combattimento',
  Luck: 'Fortuna', 'random extra damage, 0 to this': 'danno extra casuale, da 0 a questo', 'Cover per star': 'Copertura per stella', '% less damage per terrain star': '% di danno in meno per stella del terreno',
  Counterattacks: 'Contrattacchi', 'Capture and repair': 'Conquista e riparazione', 'Capture points': 'Punti di conquista', 'a unit adds its health (1-10) a turn': 'un’unità aggiunge la sua salute (1-10) a turno',
  'Repair per turn': 'Riparazione per turno', 'health out of 10': 'salute su 10', 'Repairs cost money': 'Le riparazioni costano', Victory: 'Vittoria',
  'Taking an HQ defeats its owner': 'Prendere un quartier generale sconfigge il proprietario', 'Losing every unit defeats a player': 'Chi perde tutte le unità è sconfitto',
  'Day limit': 'Limite di giorni', '0 = none; then most property wins': '0 = nessuno; poi vince chi ha più proprietà', Unit: 'Unità', Cost: 'Costo', Moves: 'Movimento', Sight: 'Vista',
  'Min range': 'Gittata min', 'Max range': 'Gittata max', Fuel: 'Carburante', 'Fuel/day': 'Carb./giorno', Ammo: 'Munizioni', Captures: 'Conquista',
  'Every army gets the same units. Fuel and ammo only matter in games with fuel and ammo on (0 = unlimited).': 'Ogni esercito ha le stesse unità. Carburante e munizioni contano solo se attivi (0 = illimitati).',
  'Base damage, in percent, that each unit (row) deals to each other unit (column). Empty means it cannot attack it.': 'Danno base, in percentuale, che ogni unità (riga) infligge alle altre (colonna). Vuoto: non può attaccarla.',
  '↓ hits →': '↓ colpisce →', 'Apply JSON': 'Applica JSON',
  'The whole rule set as JSON: terrain, powers, weather, armies (name and colours only). Apply to use it.': 'Tutte le regole in JSON: terreni, poteri, meteo, eserciti (solo nome e colori). Applica per usarle.',
  '✓ The engine accepts these rules': '✓ Il motore accetta queste regole', '✓ Saved in this browser: pick it on the setup screen': '✓ Salvate in questo browser: sceglile nella preparazione',
  '✓ Link copied: whoever opens it gets these rules on the setup screen': '✓ Link copiato: chi lo apre trova queste regole nella preparazione',
  'Share this link:': 'Condividi questo link:',
  // ---- files ----
  'That file is not an OpenTactics replay or saved game.': 'Questo file non è un replay o un salvataggio di OpenTactics.',
  // ---- rules, maps and missions (content) ----
  'Sixteen units on land, sea and air, with transports and submarines. Every army is identical.': 'Sedici unità per terra, mare e aria, con trasporti e sottomarini. Ogni esercito è identico.',
  'Start rich, no luck, 15 days. Most property wins.': 'Si parte ricchi, niente fortuna, 15 giorni. Vince chi ha più proprietà.',
  'Cheap. Captures property.': 'Economica. Conquista proprietà.', 'Slow bazooka team. Captures, crosses mountains, hurts vehicles.': 'Squadra bazooka lenta. Conquista, attraversa le montagne, danneggia i veicoli.',
  'Fast on roads. Good against foot soldiers.': 'Veloce su strada. Buono contro la fanteria.', 'The backbone of a ground army.': 'La spina dorsale di un esercito di terra.',
  'Fires 2-3 tiles. Cannot move and fire, cannot shoot back.': 'Spara a 2-3 caselle. Non può muovere e sparare, non può rispondere al fuoco.',
  'Fires 3-5 tiles. Helpless up close.': 'Spara a 3-5 caselle. Indifeso da vicino.', 'Shreds aircraft and foot soldiers.': 'Fa a pezzi aerei e fanteria.',
  'Flies over anything. Strong against ground units.': 'Vola sopra tutto. Forte contro le unità di terra.', 'Rules the sky and hits hard below.': 'Domina il cielo e colpisce duro a terra.',
  'Light warship. Harasses coasts.': 'Nave leggera. Disturba le coste.', 'Hunts aircraft and smaller ships.': 'Caccia aerei e navi più piccole.', 'Fires 2-5 tiles from the sea.': 'Spara a 2-5 caselle dal mare.',
  'Unarmed. Carries one foot unit and refills fuel and ammunition of units next to it.': 'Disarmato. Trasporta un’unità a piedi e rifornisce carburante e munizioni a chi gli sta accanto.',
  'Unarmed helicopter that carries one foot unit.': 'Elicottero disarmato che trasporta un’unità a piedi.', 'Unarmed ship that carries two ground units across the sea.': 'Nave disarmata che porta due unità di terra oltre il mare.',
  'Dives out of sight; only ships that hunt submarines can find it. Diving burns fuel.': 'Si immerge e sparisce; solo le navi da caccia ai sottomarini la trovano. Immergersi consuma carburante.',
  'Each one you hold makes all your units deal 10% more damage.': 'Ognuna che possiedi fa infliggere il 10% di danni in più a tutte le tue unità.',
  'Ships can come ashore here, so landers can land troops.': 'Qui le navi possono approdare, così i mezzi da sbarco sbarcano le truppe.',
  'Rocks: slow and good cover for ships, which hide here in fog of war.': 'Scogli: lenti e buona copertura per le navi, che qui si nascondono nella nebbia.',
  'Nothing special.': 'Niente di particolare.', 'Vehicles move slower; with fog of war, everyone sees one tile less.': 'I veicoli rallentano; con la nebbia tutti vedono una casella in meno.',
  'Everything moves slower.': 'Tutto si muove più lentamente.', 'Units deal 20% more damage and move one tile further.': 'Le unità infliggono il 20% di danni in più e muovono una casella in più.',
  'Units take much less damage until your next turn.': 'Le unità subiscono molti meno danni fino al tuo prossimo turno.', 'Every unit heals 2 and is refuelled and rearmed.': 'Ogni unità recupera 2 ed è rifornita e riarmata.',
  '6000 funds right now.': '6000 fondi subito.', 'Units see 3 tiles further and deal 10% more damage.': 'Le unità vedono 3 caselle più lontano e infliggono il 10% di danni in più.',
  'A small two-player duel over a river.': 'Un piccolo duello a due attraverso un fiume.', 'Two bridges, one airfield each. Hold the crossings.': 'Due ponti, un aeroporto a testa. Tenete i passaggi.',
  'Four armies on an island, with ports and airfields.': 'Quattro eserciti su un’isola, con porti e aeroporti.', 'Two valleys split by a ridge, joined by a single road.': 'Due valli divise da un crinale, unite da una sola strada.',
  'A quick, cramped duel. Fight for the middle.': 'Un duello rapido e stretto. Lottate per il centro.', 'Forests on either side of one long highway.': 'Boschi ai lati di una lunga strada.',
  'Open ground and a salt lake. Little cover anywhere.': 'Terreno aperto e un lago salato. Poca copertura ovunque.', 'Two islands and a strait. Ships and aircraft decide it.': 'Due isole e uno stretto. Decidono navi e aerei.',
  'Three armies on one round island.': 'Tre eserciti su un’isola rotonda.', 'Rivers run between the bases into a central lake.': 'I fiumi scorrono tra le basi fino a un lago centrale.',
  'Three forts in a forest, no water at all.': 'Tre forti in un bosco, niente acqua.', 'Four armies, four roads, one square in the middle.': 'Quattro eserciti, quattro strade, una piazza al centro.',
  'Four corners, a lake between each pair of neighbours.': 'Quattro angoli, un lago tra ogni coppia di vicini.', 'A ring of land around a lagoon. Four ports, four airfields.': 'Un anello di terra intorno a una laguna. Quattro porti, quattro aeroporti.',
  'Six armies on a big island. Alliances will not last.': 'Sei eserciti su una grande isola. Le alleanze non dureranno.', 'Eight armies around a lake. Chaos guaranteed.': 'Otto eserciti intorno a un lago. Caos garantito.',
  'A tiny, fast duel.': 'Un duello minuscolo e veloce.', 'A long front cut by a river, with bridges to fight over.': 'Un lungo fronte tagliato da un fiume, con ponti da contendersi.',
  'Two islands around a lagoon. Ports and airfields decide it.': 'Due isole intorno a una laguna. Decidono porti e aeroporti.', 'Mountain country: infantry and artillery rule here.': 'Terra di montagna: qui comandano fanteria e artiglieria.',
  'Three armies, close quarters.': 'Tre eserciti, a distanza ravvicinata.', 'Three shores of one lake, with rivers between.': 'Tre rive di un lago, con fiumi in mezzo.',
  'Four armies on open ground. Quick and bloody.': 'Quattro eserciti in campo aperto. Rapido e sanguinoso.', 'Four islands split by straits.': 'Quattro isole divise da stretti.',
  'A large four-way war with a ring road.': 'Una grande guerra a quattro con una strada ad anello.', 'Five armies on an island.': 'Cinque eserciti su un’isola.',
  'Six armies, six rivers, one lake.': 'Sei eserciti, sei fiumi, un lago.', 'Six islands around a shared middle.': 'Sei isole intorno a un centro comune.',
  'Eight armies around a big lake.': 'Otto eserciti intorno a un grande lago.', 'Eight islands joined by bridges.': 'Otto isole unite da ponti.',
  'Nine armies. Watch your neighbours.': 'Nove eserciti. Occhio ai vicini.', 'Ten armies on one island.': 'Dieci eserciti su un’isola.',
  'Twelve armies around a small lake.': 'Dodici eserciti intorno a un piccolo lago.', 'Twelve armies, each behind its own river.': 'Dodici eserciti, ognuno dietro il suo fiume.',
  'Sixteen armies. The biggest war there is.': 'Sedici eserciti. La guerra più grande che ci sia.', 'Sixteen armies on a ring of land around an inland sea.': 'Sedici eserciti su un anello di terra intorno a un mare interno.',
  '1 · Basic training': '1 · Addestramento di base', 'Move, attack, finish the job.': 'Muovi, attacca, porta a termine.',
  'Two enemy squads have strayed into our training ground. Destroy them before day 8.': 'Due squadre nemiche si sono perse nel nostro campo di addestramento. Distruggile entro il giorno 8.',
  'Tap one of your units to see where it can go (white) and what it could hit (red).': 'Tocca una tua unità per vedere dove può andare (bianco) e cosa può colpire (rosso).',
  'Tap a white tile to move there, then choose Fire and tap a target, or Wait.': 'Tocca una casella bianca per andarci, poi scegli Fuoco e tocca un bersaglio, oppure Attendi.',
  'The forecast shows the damage you deal and what comes back. Hurt units hit softer.': 'La previsione mostra il danno che infliggi e quello che torna indietro. Le unità ferite colpiscono meno.',
  'Forests and mountains protect whoever stands on them.': 'Boschi e montagne proteggono chi ci sta sopra.',
  '2 · Taking ground': '2 · Conquistare terreno', 'Capture property to earn money and win.': 'Conquista proprietà per guadagnare e vincere.',
  'Take the enemy headquarters on the far side. Cities on the way pay 1000 a day each.': 'Prendi il quartier generale nemico dall’altra parte. Le città lungo la strada rendono 1000 al giorno ciascuna.',
  'Infantry and mechs capture. Move onto a city and choose Capture.': 'Fanteria e bazooka conquistano. Vai su una città e scegli Conquista.',
  'A capture takes 20 points; a unit adds its health (up to 10) each turn, so two turns at full health.': 'Una conquista richiede 20 punti; un’unità aggiunge la sua salute (fino a 10) a turno, quindi due turni a piena salute.',
  'If the capturing unit moves away or is hurt, progress is lost or slower.': 'Se l’unità che conquista si sposta o viene ferita, il progresso si perde o rallenta.',
  'Capturing the enemy headquarters wins at once.': 'Conquistare il quartier generale nemico fa vincere subito.',
  '3 · Factory floor': '3 · In fabbrica', 'Build an army and stop the raid.': 'Costruisci un esercito e ferma l’incursione.',
  'A raiding party is coming for our headquarters. Use the factory to build units and wipe the raiders out.': 'Un gruppo di predoni punta al nostro quartier generale. Usa la fabbrica per costruire unità e spazzarli via.',
  'Tap your factory (next to the headquarters) to build. Units cannot move on the day they are built.': 'Tocca la tua fabbrica (accanto al quartier generale) per costruire. Le unità non possono muovere il giorno in cui sono costruite.',
  'Tanks are strong against vehicles, mechs are cheap tank-killers, infantry are cheap and capture.': 'I carri sono forti contro i veicoli, i bazooka sono anticarro economici, la fanteria costa poco e conquista.',
  'Every property you own pays you at the start of your turn.': 'Ogni tua proprietà ti paga all’inizio del turno.',
  'Units on your cities and headquarters are repaired a little each turn, for a share of their price.': 'Le unità sulle tue città e sul quartier generale si riparano un po’ a ogni turno, pagando una parte del loro prezzo.',
  '4 · Over the water': '4 · Oltre il mare', 'Transports: board, sail, unload.': 'Trasporti: sali, naviga, scarica.',
  'The enemy headquarters is on the eastern island. Ferry your troops across and take it.': 'Il quartier generale nemico è sull’isola a est. Porta le truppe dall’altra parte e prendilo.',
  'Move a foot unit onto the lander or the airlift and choose Board.': 'Porta un’unità a piedi sul mezzo da sbarco o sull’elitrasporto e scegli Sali a bordo.',
  'A loaded transport shows how many it carries. Move it, then choose Unload and tap where each passenger gets out.': 'Un trasporto carico mostra quanti ne porta. Muovilo, poi scegli Scarica e tocca dove scende ogni passeggero.',
  'Passengers cannot act on the turn they get out; plan to land next to your target.': 'I passeggeri non agiscono nel turno in cui scendono: sbarca accanto all’obiettivo.',
  'The lander carries two units; the airlift one, but it flies.': 'Il mezzo da sbarco porta due unità; l’elitrasporto una, ma vola.',
  '5 · Into the fog': '5 · Nella nebbia', 'Find hidden enemies before they find you.': 'Trova i nemici nascosti prima che trovino te.',
  'Fog of war: you only see what your units see. Enemies hide in the woods. Scout, then strike.': 'Nebbia di guerra: vedi solo ciò che vedono le tue unità. I nemici si nascondono nei boschi. Esplora, poi colpisci.',
  'Darkened tiles are out of sight. The recon sees furthest; mountains let foot units see further.': 'Le caselle scure sono fuori vista. Il ricognitore vede più lontano; dalle montagne la fanteria vede meglio.',
  'Units in forests are only seen from right next to them.': 'Le unità nei boschi si vedono solo da vicinissimo.', 'Moving into a hidden enemy stops your unit short: an ambush.': 'Finire addosso a un nemico nascosto ferma la tua unità: un’imboscata.',
  '6 · Running on empty': '6 · A secco', 'Fuel and ammo: refuel or fall from the sky.': 'Carburante e munizioni: rifornisciti o precipiti.',
  'Your helicopters are nearly dry. Aircraft burn fuel every day and crash at zero. Refuel at the airport or next to the carrier, then clear the field.': 'I tuoi elicotteri sono quasi a secco. Gli aerei consumano carburante ogni giorno e a zero precipitano. Riforniscili all’aeroporto o accanto al mezzo di supporto, poi ripulisci il campo.',
  'The unit card shows fuel and ammo. A can or crate icon on a unit means it is running low.': 'La scheda dell’unità mostra carburante e munizioni. Una tanica o una cassa sull’unità vuol dire che sta finendo.',
  'Units on your airport (aircraft), cities (ground) or next to your carrier are refilled at the start of your turn.': 'Le unità sul tuo aeroporto (aerei), sulle città (terra) o accanto al mezzo di supporto si riforniscono all’inizio del turno.',
  'A carrier can also refill its neighbours at once with Resupply.': 'Il mezzo di supporto può anche rifornire subito i vicini con Rifornisci.',
  '7 · Convoy': '7 · Convoglio', 'Get the carrier through the pass alive.': 'Porta il mezzo di supporto oltre il passo, intatto.',
  'Escort the supply carrier (the one in front of your headquarters) to the east end of the pass. If it is destroyed, the mission fails.': 'Scorta il mezzo di supporto (quello davanti al quartier generale) fino all’estremità est del passo. Se viene distrutto, la missione fallisce.',
  'The carrier is unarmed: keep your tank and anti-air between it and the enemy.': 'Il mezzo è disarmato: tieni carro e contraerea tra lui e il nemico.',
  'Artillery fires from 2 to 3 tiles away and cannot be hit back by most units.': 'L’artiglieria spara da 2-3 caselle e quasi nessuno può risponderle.',
  'The convoy must stop on the road tile at the far east edge.': 'Il convoglio deve fermarsi sulla strada all’estremità est.',
  '8 · Last stand': '8 · Ultima difesa', 'Hold the headquarters for ten days.': 'Tieni il quartier generale per dieci giorni.',
  'Three enemy factories are pouring units toward us. Hold the headquarters until day 11.': 'Tre fabbriche nemiche ci mandano contro unità su unità. Tieni il quartier generale fino al giorno 11.',
  'You do not have to win, only last. Defensive ground and repairs on your cities count.': 'Non serve vincere, solo resistere. Contano il terreno difensivo e le riparazioni sulle città.',
  'Keep the factory free so you can keep building.': 'Tieni libera la fabbrica per continuare a costruire.',
  // map names
  'First Contact': 'Primo contatto', 'River Line': 'Linea del fiume', 'Four Corners': 'Quattro angoli', 'Twin Valleys': 'Valli gemelle',
  Crossfire: 'Fuoco incrociato', 'Long Road': 'La lunga strada', 'Salt Flats': 'Saline', Archipelago: 'Arcipelago', Triad: 'Triade',
  'Three Rivers': 'Tre fiumi', 'Woodland Forts': 'Forti nel bosco', Crossroads: 'Crocevia', 'Four Lakes': 'Quattro laghi', Atoll: 'Atollo',
  Hexfall: 'Esagono', 'Grand Melee': 'Grande mischia', 'Pocket Duel': 'Duello tascabile', 'Wide Front': 'Fronte largo', 'Island Hop': 'Salto d’isola',
  Highlands: 'Altopiani', 'Small Triangle': 'Piccolo triangolo', 'Tri-Lakes': 'Tre laghi', 'Plains of Four': 'Pianure dei quattro',
  'Quad Islands': 'Quattro isole', 'Big Cross': 'Grande croce', Pentagon: 'Pentagono', 'Six Rivers': 'Sei fiumi', 'Hex Isles': 'Sei isole',
  'Octagon Lake': 'Lago ottagonale', 'Eight Isles': 'Otto isole', 'Nine Lands': 'Nove terre', Decagon: 'Decagono', 'Twelve Kingdoms': 'Dodici regni',
  Clockwork: 'Orologeria', 'Sixteen Banners': 'Sedici stendardi', 'Grand Ring': 'Grande anello',
  // ---- engine messages ----
  'It is not your turn.': 'Non è il tuo turno.', 'That unit has already acted.': 'Quell’unità ha già agito.', 'The unit cannot move there.': 'L’unità non può andare lì.',
  'That target is out of reach.': 'Quel bersaglio è fuori portata.', 'Not enough funds.': 'Fondi insufficienti.', 'That cannot be built there.': 'Non si può costruire lì.',
  'Nothing to capture there.': 'Lì non c’è niente da conquistare.', 'The game is over': 'La partita è finita', 'Something is already there.': 'C’è già qualcosa lì.',
  'That power is not charged, or one is already in use.': 'Quel potere non è carico, o ne è già attivo uno.', 'Diplomacy is off in this game.': 'In questa partita la diplomazia è disattivata.',
  'Time is up': 'Tempo scaduto',
};

// Sentences with names and numbers. `$n` is a group as is; `@n` is a group translated as a name.
const IT_PATTERNS = [
  [/^Day (\d+)$/, 'Giorno $1'],
  [/^Day (\d+): (.+) \(\+(\d+)\)$/, 'Giorno $1: @2 (+$3)'],
  [/^(.+) hits (.+) for (\d+)%( \(counter\))?$/, (m, a, b, n, c) => `${name(a)} colpisce ${name(b)}: ${n}%${c ? ' (contrattacco)' : ''}`],
  [/^(.+) destroyed$/, '@1 distrutto'],
  [/^(.+) builds (.+)$/, '@1 costruisce @2'],
  [/^(.+) captures a (.+)$/, '@1 conquista: @2'],
  [/^(.+) is defeated$/, '@1 è sconfitto'],
  [/^Game over: (.+)$/, 'Fine: @1'],
  [/^(.+) wins$/, 'Vince @1'],
  [/^(.+) win$/, (m, a) => `Vincono ${a.split(' & ').map(name).join(' e ')}`],
  [/^(.+)'s turn$/, 'Turno di @1'],
  [/^Waiting for (.+)\.$/, (m, a) => `In attesa di ${a.split(', ').map(name).join(', ')}.`],
  [/^(\d+) players…$/, '$1 giocatori…'],
  [/^(\d+) players at once$/, '$1 giocatori insieme'],
  [/^(.+)…$/, (m, a) => (IT[a] || IT_WORDS[a] ? `${name(a)}…` : null)],
  [/^Build · (\d+) funds$/, 'Costruisci · $1 fondi'],
  [/^HP (\d+)\/10 · Move (\d+) · Range (.+)$/, 'Salute $1/10 · Movimento $2 · Gittata $3'],
  [/^Fuel (\d+)\/(\d+) · Ammo (\d+)\/(\d+)$/, 'Carburante $1/$2 · Munizioni $3/$4'],
  [/^Fuel (\d+)\/(\d+)$/, 'Carburante $1/$2'], [/^Ammo (\d+)\/(\d+)$/, 'Munizioni $1/$2'],
  [/^Carrying (.+)$/, (m, a) => `Trasporta ${a.split(', ').map(name).join(', ')}`],
  [/^Carries (.+)$/, (m, a) => `Può trasportare ${a.split(', ').map(name).join(', ')}`],
  [/^Held by (.+)$/, 'Di @1'], [/^ · \+(\d+)\/day$/, ' · +$1/giorno'],
  [/^Builds (.+) units$/, 'Costruisce unità: $1'], [/^Capture (\d+)\/(\d+)$/, 'Conquista $1/$2'],
  [/^(\d+)×(\d+) · (\d+) players(.*)$/, (m, w, h, n, rest) => `${w}×${h} · ${n} giocatori${rest.replace(' · yours', ' · tua').replace(' · from URL', ' · da URL').replace(' · shared', ' · condivisa')}`],
  [/^(.+): (.+) (\d+) units, (\d+) terrains, (\d+) armies\.$/, (m, n, d, u, t, a) => `${name(n)}: ${tr(d)} ${u} unità, ${t} terreni, ${a} eserciti.`],
  [/^Hill: free \((\d+) days to win\)$/, 'Collina: libera ($1 giorni per vincere)'],
  [/^Hill: (.+) (\d+)\/(\d+)$/, 'Collina: @1 $2/$3'],
  [/^Storm from day (\d+)$/, 'Tempesta dal giorno $1'], [/^Storm: ([\d.]+) tiles$/, 'Tempesta: $1 caselle'],
  [/^Survive to day (\d+) · wave in (\d+)$/, 'Resisti fino al giorno $1 · ondata tra $2'],
  [/^Score race: day (\d+)\/(\d+)$/, 'Corsa ai punti: giorno $1/$2'],
  [/^Safe circle: ([\d.]+) tiles$/, 'Cerchio sicuro: $1 caselle'],
  [/^(.+) holds the hill \((\d+)\)$/, '@1 tiene la collina ($2)'],
  [/^(\d+) units? (?:has|have) not moved$/, (m, n) => `${n} unità non si ${n === '1' ? 'è mossa' : 'sono mosse'}`],
  [/^(.+) offers (.+) an alliance$/, '@1 offre a @2 un’alleanza'],
  [/^(.+) offers (.+) a (\d+)-day truce$/, '@1 offre a @2 una tregua di $3 giorni'],
  [/^(.+) accepts an alliance with (.+)$/, '@1 accetta un’alleanza con @2'],
  [/^(.+) accepts a (\d+)-day truce with (.+)$/, '@1 accetta una tregua di $2 giorni con @3'],
  [/^(.+) turns down (.+)'s offer$/, '@1 rifiuta l’offerta di @2'],
  [/^(.+) leaves the alliance$/, '@1 lascia l’alleanza'],
  [/^The truce between (.+) and (.+) ends$/, 'Finisce la tregua tra @1 e @2'],
  [/^offers a (\d+)-day truce$/, 'offre una tregua di $1 giorni'],
  [/^Truce until day (\d+)$/, 'Tregua fino al giorno $1'],
  [/^Diplomacy \((\d+)\)$/, 'Diplomazia ($1)'],
  [/^Powers · charge (\d+)$/, 'Poteri · carica $1'],
  [/^(.+) is active until your next turn\.$/, '@1 è attivo fino al tuo prossimo turno.'],
  [/^(.+) uses (.+)$/, '@1 usa @2'],
  [/^(.+) · (.+)$/, (m, a, b) => (IT_WORDS[a] && (IT[b] || IT_WORDS[b]) ? `${name(a)} · ${tr(b)}` : null)],
  [/^The weather turns: (.+)$/, 'Il tempo cambia: @1'],
  [/^(.+) runs into a hidden enemy$/, '@1 finisce addosso a un nemico nascosto'],
  [/^(.+) boards the (.+)$/, '@1 sale su @2'],
  [/^(.+) units join(?: \(\+(\d+) funds\))?$/, (m, a, f) => `Unità ${name(a)} unite${f ? ` (+${f} fondi)` : ''}`],
  [/^(.+) runs out of fuel and is lost$/, '@1 resta senza carburante ed è perduto'],
  [/^(.+) resupplies (\d+) units?$/, '@1 rifornisce $2 unità'],
  [/^Where does the (.+) get out\?$/, 'Dove scende @1?'],
  [/^Day (\d+) to day (\d+)$/, 'Dal giorno $1 al giorno $2'],
  [/^(.+) · stats$/, '$1 · statistiche'],
  [/^(.+) · peak (\d+)$/, (m, a, n) => `${tr(a)} · massimo ${n}`],
  [/^Move (\d+) of (\d+) · day (\d+)$/, 'Mossa $1 di $2 · giorno $3'],
  [/^Replay · (.*)$/, 'Replay · $1'],
  [/^Next: (.+)$/, (m, a) => `Prossima: ${tr(a)}`],
  [/^Playing online as (.+)$/, 'Online come @1'],
  [/^Room (\w+) · (.*)$/, (m, c, rest) => `Stanza ${c} · ${rest.replace('no guests', 'nessun ospite').replace(/(\d+) watching/, '$1 spettatori')}`],
  [/^Room (\w+) is open again\.$/, 'La stanza $1 è di nuovo aperta.'],
  [/^Resume hosting room (\w+)$/, 'Riprendi la stanza $1'],
  [/^(.+), day (\d+)\. Your guests reconnect on their own\.$/, '$1, giorno $2. I tuoi ospiti si riconnettono da soli.'],
  [/^Lost the host\. Reconnecting \(attempt (\d+)\)…$/, 'Connessione persa. Riconnessione (tentativo $1)…'],
  [/^Time is up for (.+)\.$/, (m, a) => `Tempo scaduto per ${a.split(', ').map(name).join(', ')}.`],
  [/^(.+) lost connection$/, '$1 ha perso la connessione'], [/^(.+) is back$/, '$1 è tornato'],
  [/^Map: (.+) · Rules: (.+?)(?: with (.+))?\. Waiting for the host to start…$/, (m, a, b, c) => `Mappa: ${a} · Regole: ${tr(b)}${c ? ` con ${c}` : ''}. In attesa che chi ospita inizi…`],
  [/^(.+) \(you\)$/, '$1 (tu)'],
  [/^Capture the marked (.+)$/, 'Conquista: @1 (segnata)'], [/^Do not lose the marked (.+)$/, 'Non perdere: @1 (segnata)'],
  [/^Do not let the enemy take the marked (.+)$/, 'Non lasciare al nemico: @1 (segnata)'], [/^Make the enemy take the marked (.+)$/, 'Fai prendere al nemico: @1 (segnata)'],
  [/^Finish before day (\d+)$/, 'Finisci prima del giorno $1'], [/^Hold out until day (\d+)$/, 'Resisti fino al giorno $1'],
  [/^Keep the (.+) alive$/, 'Tieni in vita: $1'], [/^Destroy the (.+)$/, 'Distruggi: $1'],
  [/^Bring the (.+) to the marked tile$/, 'Porta $1 sulla casella segnata'], [/^Keep the (.+) away from the marked tile$/, 'Tieni $1 lontano dalla casella segnata'],
  [/^Played with (.+)\.$/, 'Con $1.'],
  [/^(\d+) goals?, (\d+) ways? to fail\. You play (.+)\.$/, '$1 obiettivi, $2 modi di perdere. Giochi con @3.'],
  [/^Seed (\d+)\. (.+)$/, (m, n, rest) => `Seme ${n}. ${tr(rest)}`],
  [/^Generated (\d+)p #(\d+)$/, 'Generata $1g #$2'], [/^A generated map for (\d+) players\.$/, 'Una mappa generata per $1 giocatori.'],
  [/^Charge up by fighting, then use one of (\d+) powers\. Everyone picks from the same list\.$/, 'Ti carichi combattendo, poi usi uno dei $1 poteri. Tutti scelgono dalla stessa lista.'],
  [/^Always (.+)$/, (m, a) => `Sempre ${tr(a[0].toUpperCase() + a.slice(1)).toLowerCase()}`],
  [/^Custom: (.+)$/, 'Personalizzate: $1'], [/^Shared: (.+)$/, 'Condivise: $1'],
  [/^Could not (.+): (.+)$/, (m, a, b) => `Impossibile (${a}): ${tr(b)}`],
  [/^This map cannot be played yet: (.+)$/, 'Questa mappa non si può ancora giocare: $1'], [/^Fix this first: (.+)$/, 'Prima sistema questo: $1'],
  [/^Other players' moves: (.+)$/, (m, a) => `Mosse degli altri: ${tr(a).toLowerCase()}`],
  [/^Music: (on|off)$/, (m, a) => `Musica: ${a === 'on' ? 'sì' : 'no'}`],
  [/^(.+): (\d+) units(?: · (.+) active)?$/, (m, a, n, p) => `${name(a)}: ${n} unità${p ? ` · ${name(p)} attivo` : ''}`],
  [/^(.+) \((.)\)$/, (m, a, g) => (IT_WORDS[a] ? `${IT_WORDS[a]} (${g})` : null)],
  [/^⚠ (.+)$/, (m, a) => `⚠ ${tr(a)}`],
  [/^map: (.+)$/, (m, a) => `mappa: ${tr(a)}`],
  [/^player (\d+) starts with no property and no unit$/, 'il giocatore $1 non ha né proprietà né unità'],
  [/^a (.+) cannot stand on tile (\d+),(\d+)$/, (m, a, x, y) => `${name(a[0].toUpperCase() + a.slice(1))} non può stare sulla casella ${x},${y}`],
  [/^needs 2 to (\d+) players, has (\d+)$/, 'servono da 2 a $1 giocatori, ce ne sono $2'],
];

let table = null, patterns = [];

/** The language in use: from the settings, else the device. */
export function language() {
  let chosen = 'auto';
  try { chosen = JSON.parse(localStorage.getItem('ot.settings') || '{}').lang || 'auto'; } catch { /* default */ }
  if (chosen !== 'auto') return chosen;
  return (navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en';
}

function name(text) {
  if (!table) return text;
  if (table[text]) return table[text];
  // "city" (written in lower case inside a sentence) → "città".
  const cap = text && text[0].toUpperCase() + text.slice(1);
  if (cap !== text && table[cap]) return table[cap].toLowerCase();
  // "Red Infantry": army, then unit → "Fanteria (Rosso)".
  const sp = text.indexOf(' ');
  for (let i = sp; i > 0; i = text.indexOf(' ', i + 1)) {
    const a = text.slice(0, i), b = text.slice(i + 1);
    if (IT_WORDS[a] && IT_WORDS[b]) return `${IT_WORDS[b]} (${IT_WORDS[a]})`;
  }
  return text;
}

/** Translate one piece of text, or return it as it is. */
export function tr(text) {
  if (!table || !text) return text;
  const core = text.trim();
  if (!core || !/[A-Za-z]/.test(core)) return text;
  const lead = text.slice(0, text.indexOf(core)), tail = text.slice(text.indexOf(core) + core.length);
  if (table[text] != null) return table[text];
  if (table[core] != null) return lead + table[core] + tail;
  for (const [re, to] of patterns) {
    const m = re.exec(core);
    if (!m) continue;
    const out = typeof to === 'function'
      ? to(...m)
      : to.replace(/([$@])(\d)/g, (_, kind, n) => (kind === '@' ? name(m[n]) : m[n] ?? ''));
    if (out != null) return lead + out + tail;
  }
  return text;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
function walk(node) {
  if (node.nodeType === 3) {
    const t = tr(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
  for (const a of ATTRS) {
    const v = node.getAttribute?.(a);
    if (v) { const t = tr(v); if (t !== v) node.setAttribute(a, t); }
  }
  // What people type in a text box is theirs: only its placeholder is ours.
  if (node.tagName === 'TEXTAREA') return;
  for (const c of node.childNodes) walk(c);
}

/** Start translating the page (and dialogs) if the language is not English. */
export function start() {
  const lang = language();
  document.documentElement.lang = lang;
  if (lang !== 'it') return;
  table = { ...IT, Join: 'Unisciti', Start: 'Inizia' };
  patterns = IT_PATTERNS;
  walk(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') walk(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const { alert, confirm, prompt } = window;
  window.alert = msg => alert.call(window, tr(String(msg)));
  window.confirm = msg => confirm.call(window, tr(String(msg)));
  window.prompt = (msg, def) => prompt.call(window, tr(String(msg)), def);
}
