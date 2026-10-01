/**
 * The game's anti-cheat notice, rewritten in every language Dota ships (src/notice-text.ts puts
 * them in). Keyed by the name Dota gives a language in its own files: dota_<name>.txt.
 *
 * Four strings. `header` titles both windows ("Valve Anti-Cheat (VAC)" in Valve's words),
 * `warning` is the notice that matchmaking may stop working, `solo` and `party` say it has, for
 * you or for somebody in your party. Each says what happened without the word VAC, and what to
 * do: verify the game files, restart Steam, and turn mods off with the app's "Mods" switch. The
 * switch is named as the app shows it, «Моды» in Russian and "Mods" everywhere else, because the
 * app is in those two languages only.
 *
 * No ASCII double quote may appear in a string: they are written into a quoted KeyValues value.
 */
const NOTICE_TEXTS = {
  english: {
    header: 'Game check',
    warning: 'The game did not pass its check for online play, so matchmaking may not work. Verifying the game files in Steam and restarting Steam usually fixes it. If you use mods, turn them off with the “Mods” switch in Dota 2 Mod Manager.',
    solo: 'Matchmaking is unavailable: the game did not pass its check for online play. Verify the game files in Steam and restart Steam. If you use mods, turn them off with the “Mods” switch in Dota 2 Mod Manager.',
    party: 'Matchmaking is unavailable: for one of the players in your party, the game did not pass its check for online play. They should verify the game files in Steam, restart Steam and turn off any mods with the “Mods” switch in Dota 2 Mod Manager.',
  },
  russian: {
    header: 'Проверка игры',
    warning: 'Игра не прошла проверку перед сетевой игрой, и поиск матча может не работать. Обычно помогает проверка целостности файлов в Steam и перезапуск Steam. Если стоят моды, выключи их переключателем «Моды» в Dota 2 Mod Manager.',
    solo: 'Поиск матча недоступен: игра не прошла проверку перед сетевой игрой. Проверь целостность файлов в Steam и перезапусти Steam. Если стоят моды, выключи их переключателем «Моды» в Dota 2 Mod Manager.',
    party: 'Поиск матча недоступен: у одного из игроков группы игра не прошла проверку перед сетевой игрой. Ему стоит проверить целостность файлов в Steam, перезапустить Steam и выключить моды переключателем «Моды» в Dota 2 Mod Manager.',
  },
  ukrainian: {
    header: 'Перевірка гри',
    warning: 'Гра не пройшла перевірку перед мережевою грою, тому пошук матчу може не працювати. Зазвичай допомагає перевірка цілісності файлів у Steam і перезапуск Steam. Якщо встановлено моди, вимкни їх перемикачем «Mods» у Dota 2 Mod Manager.',
    solo: 'Пошук матчу недоступний: гра не пройшла перевірку перед мережевою грою. Перевір цілісність файлів у Steam і перезапусти Steam. Якщо встановлено моди, вимкни їх перемикачем «Mods» у Dota 2 Mod Manager.',
    party: 'Пошук матчу недоступний: в одного з гравців групи гра не пройшла перевірку перед мережевою грою. Йому варто перевірити цілісність файлів у Steam, перезапустити Steam і вимкнути моди перемикачем «Mods» у Dota 2 Mod Manager.',
  },
  bulgarian: {
    header: 'Проверка на играта',
    warning: 'Играта не премина проверката за онлайн игра, затова търсенето на мач може да не работи. Обикновено помага проверката на файловете на играта в Steam и рестартиране на Steam. Ако използваш модове, изключи ги с превключвателя „Mods“ в Dota 2 Mod Manager.',
    solo: 'Търсенето на мач не е достъпно: играта не премина проверката за онлайн игра. Провери файловете на играта в Steam и рестартирай Steam. Ако използваш модове, изключи ги с превключвателя „Mods“ в Dota 2 Mod Manager.',
    party: 'Търсенето на мач не е достъпно: при един от играчите в групата ти играта не премина проверката за онлайн игра. Той трябва да провери файловете на играта в Steam, да рестартира Steam и да изключи модовете с превключвателя „Mods“ в Dota 2 Mod Manager.',
  },
  czech: {
    header: 'Kontrola hry',
    warning: 'Hra neprošla kontrolou pro hraní online, takže hledání zápasu nemusí fungovat. Obvykle pomůže ověřit soubory hry ve službě Steam a restartovat Steam. Pokud používáš módy, vypni je přepínačem „Mods“ v Dota 2 Mod Manager.',
    solo: 'Hledání zápasu není k dispozici: hra neprošla kontrolou pro hraní online. Ověř soubory hry ve službě Steam a restartuj Steam. Pokud používáš módy, vypni je přepínačem „Mods“ v Dota 2 Mod Manager.',
    party: 'Hledání zápasu není k dispozici: jednomu z hráčů ve tvé skupině hra neprošla kontrolou pro hraní online. Tento hráč by měl ověřit soubory hry ve službě Steam, restartovat Steam a vypnout módy přepínačem „Mods“ v Dota 2 Mod Manager.',
  },
  danish: {
    header: 'Spilkontrol',
    warning: 'Spillet bestod ikke kontrollen til onlinespil, så matchmaking virker måske ikke. Det hjælper som regel at bekræfte spilfilerne i Steam og genstarte Steam. Hvis du bruger mods, så slå dem fra med kontakten »Mods« i Dota 2 Mod Manager.',
    solo: 'Matchmaking er ikke tilgængelig: spillet bestod ikke kontrollen til onlinespil. Bekræft spilfilerne i Steam, og genstart Steam. Hvis du bruger mods, så slå dem fra med kontakten »Mods« i Dota 2 Mod Manager.',
    party: 'Matchmaking er ikke tilgængelig: hos en af spillerne i din gruppe bestod spillet ikke kontrollen til onlinespil. Vedkommende bør bekræfte spilfilerne i Steam, genstarte Steam og slå mods fra med kontakten »Mods« i Dota 2 Mod Manager.',
  },
  dutch: {
    header: 'Spelcontrole',
    warning: 'Het spel heeft de controle voor online spelen niet doorstaan, daardoor werkt matchmaking misschien niet. Meestal helpt het om de spelbestanden in Steam te controleren en Steam opnieuw te starten. Gebruik je mods, zet ze dan uit met de schakelaar ‘Mods’ in Dota 2 Mod Manager.',
    solo: 'Matchmaking is niet beschikbaar: het spel heeft de controle voor online spelen niet doorstaan. Controleer de spelbestanden in Steam en start Steam opnieuw. Gebruik je mods, zet ze dan uit met de schakelaar ‘Mods’ in Dota 2 Mod Manager.',
    party: 'Matchmaking is niet beschikbaar: bij een van de spelers in je groep heeft het spel de controle voor online spelen niet doorstaan. Die speler moet de spelbestanden in Steam controleren, Steam opnieuw starten en mods uitzetten met de schakelaar ‘Mods’ in Dota 2 Mod Manager.',
  },
  finnish: {
    header: 'Pelin tarkistus',
    warning: 'Peli ei läpäissyt verkkopelin tarkistusta, joten ottelunhaku ei ehkä toimi. Yleensä auttaa pelitiedostojen tarkistaminen Steamissä ja Steamin uudelleenkäynnistys. Jos käytät modeja, poista ne käytöstä Dota 2 Mod Managerin ”Mods”-kytkimellä.',
    solo: 'Ottelunhaku ei ole käytettävissä: peli ei läpäissyt verkkopelin tarkistusta. Tarkista pelitiedostot Steamissä ja käynnistä Steam uudelleen. Jos käytät modeja, poista ne käytöstä Dota 2 Mod Managerin ”Mods”-kytkimellä.',
    party: 'Ottelunhaku ei ole käytettävissä: yhdellä ryhmäsi pelaajista peli ei läpäissyt verkkopelin tarkistusta. Hänen kannattaa tarkistaa pelitiedostot Steamissä, käynnistää Steam uudelleen ja poistaa modit käytöstä Dota 2 Mod Managerin ”Mods”-kytkimellä.',
  },
  french: {
    header: 'Vérification du jeu',
    warning: 'Le jeu n’a pas passé sa vérification pour le jeu en ligne, la recherche de partie risque donc de ne pas fonctionner. Vérifier les fichiers du jeu dans Steam puis redémarrer Steam règle généralement le problème. Si vous utilisez des mods, désactivez-les avec l’interrupteur « Mods » de Dota 2 Mod Manager.',
    solo: 'La recherche de partie est indisponible : le jeu n’a pas passé sa vérification pour le jeu en ligne. Vérifiez les fichiers du jeu dans Steam et redémarrez Steam. Si vous utilisez des mods, désactivez-les avec l’interrupteur « Mods » de Dota 2 Mod Manager.',
    party: 'La recherche de partie est indisponible : pour l’un des joueurs de votre groupe, le jeu n’a pas passé sa vérification pour le jeu en ligne. Il doit vérifier les fichiers du jeu dans Steam, redémarrer Steam et désactiver ses mods avec l’interrupteur « Mods » de Dota 2 Mod Manager.',
  },
  german: {
    header: 'Spielprüfung',
    warning: 'Das Spiel hat die Prüfung für das Onlinespiel nicht bestanden, daher funktioniert die Spielsuche möglicherweise nicht. Meist hilft es, die Spieldateien in Steam zu überprüfen und Steam neu zu starten. Wenn du Mods nutzt, schalte sie mit dem Schalter „Mods“ in Dota 2 Mod Manager aus.',
    solo: 'Die Spielsuche ist nicht verfügbar: Das Spiel hat die Prüfung für das Onlinespiel nicht bestanden. Überprüfe die Spieldateien in Steam und starte Steam neu. Wenn du Mods nutzt, schalte sie mit dem Schalter „Mods“ in Dota 2 Mod Manager aus.',
    party: 'Die Spielsuche ist nicht verfügbar: Bei einem Spieler deiner Gruppe hat das Spiel die Prüfung für das Onlinespiel nicht bestanden. Er sollte die Spieldateien in Steam überprüfen, Steam neu starten und Mods mit dem Schalter „Mods“ in Dota 2 Mod Manager ausschalten.',
  },
  greek: {
    header: 'Έλεγχος παιχνιδιού',
    warning: 'Το παιχνίδι δεν πέρασε τον έλεγχο για διαδικτυακό παιχνίδι, γι’ αυτό η αναζήτηση αγώνα ίσως να μη λειτουργεί. Συνήθως βοηθά ο έλεγχος των αρχείων του παιχνιδιού στο Steam και η επανεκκίνηση του Steam. Αν χρησιμοποιείς mods, απενεργοποίησέ τα με τον διακόπτη «Mods» στο Dota 2 Mod Manager.',
    solo: 'Η αναζήτηση αγώνα δεν είναι διαθέσιμη: το παιχνίδι δεν πέρασε τον έλεγχο για διαδικτυακό παιχνίδι. Έλεγξε τα αρχεία του παιχνιδιού στο Steam και επανεκκίνησε το Steam. Αν χρησιμοποιείς mods, απενεργοποίησέ τα με τον διακόπτη «Mods» στο Dota 2 Mod Manager.',
    party: 'Η αναζήτηση αγώνα δεν είναι διαθέσιμη: σε έναν από τους παίκτες της ομάδας σου το παιχνίδι δεν πέρασε τον έλεγχο για διαδικτυακό παιχνίδι. Πρέπει να ελέγξει τα αρχεία του παιχνιδιού στο Steam, να επανεκκινήσει το Steam και να απενεργοποιήσει τα mods με τον διακόπτη «Mods» στο Dota 2 Mod Manager.',
  },
  hungarian: {
    header: 'Játékellenőrzés',
    warning: 'A játék nem ment át az online játék előtti ellenőrzésen, ezért a meccskeresés lehet, hogy nem működik. Általában segít a játékfájlok ellenőrzése a Steamben és a Steam újraindítása. Ha modokat használsz, kapcsold ki őket a Dota 2 Mod Manager „Mods” kapcsolójával.',
    solo: 'A meccskeresés nem érhető el: a játék nem ment át az online játék előtti ellenőrzésen. Ellenőrizd a játékfájlokat a Steamben, és indítsd újra a Steamet. Ha modokat használsz, kapcsold ki őket a Dota 2 Mod Manager „Mods” kapcsolójával.',
    party: 'A meccskeresés nem érhető el: a csapatod egyik játékosánál a játék nem ment át az online játék előtti ellenőrzésen. Neki ellenőriznie kell a játékfájlokat a Steamben, újra kell indítania a Steamet, és ki kell kapcsolnia a modokat a Dota 2 Mod Manager „Mods” kapcsolójával.',
  },
  italian: {
    header: 'Verifica del gioco',
    warning: 'Il gioco non ha superato la verifica per il gioco online, quindi la ricerca della partita potrebbe non funzionare. Di solito basta verificare i file di gioco su Steam e riavviare Steam. Se usi delle mod, disattivale con l’interruttore «Mods» di Dota 2 Mod Manager.',
    solo: 'La ricerca della partita non è disponibile: il gioco non ha superato la verifica per il gioco online. Verifica i file di gioco su Steam e riavvia Steam. Se usi delle mod, disattivale con l’interruttore «Mods» di Dota 2 Mod Manager.',
    party: 'La ricerca della partita non è disponibile: il gioco di uno dei giocatori del tuo gruppo non ha superato la verifica per il gioco online. Quel giocatore deve verificare i file di gioco su Steam, riavviare Steam e disattivare le mod con l’interruttore «Mods» di Dota 2 Mod Manager.',
  },
  japanese: {
    header: 'ゲームのチェック',
    warning: 'ゲームがオンラインプレイ用のチェックに通過しなかったため、マッチメイキングが機能しない可能性があります。通常は、Steam でゲームファイルの整合性を確認し、Steam を再起動すると解決します。Mod を使用している場合は、Dota 2 Mod Manager の「Mods」スイッチでオフにしてください。',
    solo: 'マッチメイキングを利用できません：ゲームがオンラインプレイ用のチェックに通過しませんでした。Steam でゲームファイルの整合性を確認し、Steam を再起動してください。Mod を使用している場合は、Dota 2 Mod Manager の「Mods」スイッチでオフにしてください。',
    party: 'マッチメイキングを利用できません：パーティー内のプレイヤーの 1 人で、ゲームがオンラインプレイ用のチェックに通過しませんでした。そのプレイヤーは Steam でゲームファイルの整合性を確認し、Steam を再起動して、Dota 2 Mod Manager の「Mods」スイッチで Mod をオフにしてください。',
  },
  koreana: {
    header: '게임 검사',
    warning: '게임이 온라인 플레이를 위한 검사를 통과하지 못해 매치메이킹이 작동하지 않을 수 있습니다. 보통 Steam에서 게임 파일 무결성을 확인하고 Steam을 다시 시작하면 해결됩니다. 모드를 사용 중이라면 Dota 2 Mod Manager의 “Mods” 스위치로 끄세요.',
    solo: '매치메이킹을 사용할 수 없습니다: 게임이 온라인 플레이를 위한 검사를 통과하지 못했습니다. Steam에서 게임 파일 무결성을 확인하고 Steam을 다시 시작하세요. 모드를 사용 중이라면 Dota 2 Mod Manager의 “Mods” 스위치로 끄세요.',
    party: '매치메이킹을 사용할 수 없습니다: 파티원 중 한 명의 게임이 온라인 플레이를 위한 검사를 통과하지 못했습니다. 해당 플레이어는 Steam에서 게임 파일 무결성을 확인하고 Steam을 다시 시작한 뒤, Dota 2 Mod Manager의 “Mods” 스위치로 모드를 꺼야 합니다.',
  },
  latam: {
    header: 'Comprobación del juego',
    warning: 'El juego no pasó la comprobación para jugar en línea, así que la búsqueda de partida podría no funcionar. Por lo general se soluciona verificando los archivos del juego en Steam y reiniciando Steam. Si usas mods, desactívalos con el interruptor “Mods” de Dota 2 Mod Manager.',
    solo: 'La búsqueda de partida no está disponible: el juego no pasó la comprobación para jugar en línea. Verifica los archivos del juego en Steam y reinicia Steam. Si usas mods, desactívalos con el interruptor “Mods” de Dota 2 Mod Manager.',
    party: 'La búsqueda de partida no está disponible: el juego de uno de los jugadores de tu grupo no pasó la comprobación para jugar en línea. Ese jugador debe verificar los archivos del juego en Steam, reiniciar Steam y desactivar sus mods con el interruptor “Mods” de Dota 2 Mod Manager.',
  },
  norwegian: {
    header: 'Spillkontroll',
    warning: 'Spillet besto ikke kontrollen for nettspill, så matchmaking fungerer kanskje ikke. Det hjelper som regel å bekrefte spillfilene i Steam og starte Steam på nytt. Hvis du bruker mods, slå dem av med bryteren «Mods» i Dota 2 Mod Manager.',
    solo: 'Matchmaking er ikke tilgjengelig: spillet besto ikke kontrollen for nettspill. Bekreft spillfilene i Steam og start Steam på nytt. Hvis du bruker mods, slå dem av med bryteren «Mods» i Dota 2 Mod Manager.',
    party: 'Matchmaking er ikke tilgjengelig: hos en av spillerne i gruppen din besto spillet ikke kontrollen for nettspill. Vedkommende bør bekrefte spillfilene i Steam, starte Steam på nytt og slå av mods med bryteren «Mods» i Dota 2 Mod Manager.',
  },
  polish: {
    header: 'Sprawdzanie gry',
    warning: 'Gra nie przeszła sprawdzenia przed grą online, więc wyszukiwanie meczu może nie działać. Zwykle pomaga weryfikacja plików gry w Steam i ponowne uruchomienie Steam. Jeśli używasz modów, wyłącz je przełącznikiem „Mods” w Dota 2 Mod Manager.',
    solo: 'Wyszukiwanie meczu jest niedostępne: gra nie przeszła sprawdzenia przed grą online. Zweryfikuj pliki gry w Steam i uruchom Steam ponownie. Jeśli używasz modów, wyłącz je przełącznikiem „Mods” w Dota 2 Mod Manager.',
    party: 'Wyszukiwanie meczu jest niedostępne: u jednego z graczy w twojej drużynie gra nie przeszła sprawdzenia przed grą online. Ten gracz powinien zweryfikować pliki gry w Steam, uruchomić Steam ponownie i wyłączyć mody przełącznikiem „Mods” w Dota 2 Mod Manager.',
  },
  portuguese: {
    header: 'Verificação do jogo',
    warning: 'O jogo não passou na verificação para jogar online, por isso a procura de partida pode não funcionar. Normalmente resolve-se verificando os ficheiros do jogo no Steam e reiniciando o Steam. Se usas mods, desativa-os com o interruptor «Mods» do Dota 2 Mod Manager.',
    solo: 'A procura de partida não está disponível: o jogo não passou na verificação para jogar online. Verifica os ficheiros do jogo no Steam e reinicia o Steam. Se usas mods, desativa-os com o interruptor «Mods» do Dota 2 Mod Manager.',
    party: 'A procura de partida não está disponível: o jogo de um dos jogadores do teu grupo não passou na verificação para jogar online. Esse jogador deve verificar os ficheiros do jogo no Steam, reiniciar o Steam e desativar os mods com o interruptor «Mods» do Dota 2 Mod Manager.',
  },
  brazilian: {
    header: 'Verificação do jogo',
    warning: 'O jogo não passou na verificação para jogar online, então a busca de partida pode não funcionar. Geralmente resolve verificar os arquivos do jogo na Steam e reiniciar a Steam. Se você usa mods, desative-os com o botão “Mods” do Dota 2 Mod Manager.',
    solo: 'A busca de partida está indisponível: o jogo não passou na verificação para jogar online. Verifique os arquivos do jogo na Steam e reinicie a Steam. Se você usa mods, desative-os com o botão “Mods” do Dota 2 Mod Manager.',
    party: 'A busca de partida está indisponível: o jogo de um dos jogadores do seu grupo não passou na verificação para jogar online. Ele deve verificar os arquivos do jogo na Steam, reiniciar a Steam e desativar os mods com o botão “Mods” do Dota 2 Mod Manager.',
  },
  romanian: {
    header: 'Verificarea jocului',
    warning: 'Jocul nu a trecut verificarea pentru jocul online, așa că găsirea unui meci s-ar putea să nu funcționeze. De obicei ajută verificarea fișierelor jocului în Steam și repornirea Steam. Dacă folosești moduri, dezactivează-le cu comutatorul „Mods” din Dota 2 Mod Manager.',
    solo: 'Căutarea unui meci nu este disponibilă: jocul nu a trecut verificarea pentru jocul online. Verifică fișierele jocului în Steam și repornește Steam. Dacă folosești moduri, dezactivează-le cu comutatorul „Mods” din Dota 2 Mod Manager.',
    party: 'Căutarea unui meci nu este disponibilă: la unul dintre jucătorii din grupul tău jocul nu a trecut verificarea pentru jocul online. Acesta trebuie să verifice fișierele jocului în Steam, să repornească Steam și să dezactiveze modurile cu comutatorul „Mods” din Dota 2 Mod Manager.',
  },
  schinese: {
    header: '游戏检查',
    warning: '游戏未通过在线游戏检查，因此可能无法匹配。通常在 Steam 中验证游戏文件完整性并重启 Steam 即可解决。如果你在使用模组，请用 Dota 2 Mod Manager 中的“Mods”开关将其关闭。',
    solo: '无法匹配：游戏未通过在线游戏检查。请在 Steam 中验证游戏文件完整性并重启 Steam。如果你在使用模组，请用 Dota 2 Mod Manager 中的“Mods”开关将其关闭。',
    party: '无法匹配：队伍中有一名玩家的游戏未通过在线游戏检查。该玩家应在 Steam 中验证游戏文件完整性、重启 Steam，并用 Dota 2 Mod Manager 中的“Mods”开关关闭模组。',
  },
  tchinese: {
    header: '遊戲檢查',
    warning: '遊戲未通過線上遊戲檢查，因此可能無法配對。通常在 Steam 中驗證遊戲檔案完整性並重新啟動 Steam 即可解決。如果你正在使用模組，請用 Dota 2 Mod Manager 中的「Mods」開關將其關閉。',
    solo: '無法配對：遊戲未通過線上遊戲檢查。請在 Steam 中驗證遊戲檔案完整性並重新啟動 Steam。如果你正在使用模組，請用 Dota 2 Mod Manager 中的「Mods」開關將其關閉。',
    party: '無法配對：隊伍中有一名玩家的遊戲未通過線上遊戲檢查。該玩家應在 Steam 中驗證遊戲檔案完整性、重新啟動 Steam，並用 Dota 2 Mod Manager 中的「Mods」開關關閉模組。',
  },
  spanish: {
    header: 'Comprobación del juego',
    warning: 'El juego no ha superado la comprobación para jugar en línea, así que la búsqueda de partida puede no funcionar. Normalmente se soluciona verificando los archivos del juego en Steam y reiniciando Steam. Si usas mods, desactívalos con el interruptor «Mods» de Dota 2 Mod Manager.',
    solo: 'La búsqueda de partida no está disponible: el juego no ha superado la comprobación para jugar en línea. Verifica los archivos del juego en Steam y reinicia Steam. Si usas mods, desactívalos con el interruptor «Mods» de Dota 2 Mod Manager.',
    party: 'La búsqueda de partida no está disponible: el juego de uno de los jugadores de tu grupo no ha superado la comprobación para jugar en línea. Ese jugador debe verificar los archivos del juego en Steam, reiniciar Steam y desactivar sus mods con el interruptor «Mods» de Dota 2 Mod Manager.',
  },
  swedish: {
    header: 'Spelkontroll',
    warning: 'Spelet klarade inte kontrollen för onlinespel, så matchmaking kanske inte fungerar. Oftast hjälper det att verifiera spelfilerna i Steam och starta om Steam. Om du använder moddar, stäng av dem med reglaget ”Mods” i Dota 2 Mod Manager.',
    solo: 'Matchmaking är inte tillgänglig: spelet klarade inte kontrollen för onlinespel. Verifiera spelfilerna i Steam och starta om Steam. Om du använder moddar, stäng av dem med reglaget ”Mods” i Dota 2 Mod Manager.',
    party: 'Matchmaking är inte tillgänglig: för en av spelarna i din grupp klarade spelet inte kontrollen för onlinespel. Den spelaren bör verifiera spelfilerna i Steam, starta om Steam och stänga av moddar med reglaget ”Mods” i Dota 2 Mod Manager.',
  },
  thai: {
    header: 'การตรวจสอบเกม',
    warning: 'เกมไม่ผ่านการตรวจสอบสำหรับการเล่นออนไลน์ การค้นหาแมตช์จึงอาจใช้งานไม่ได้ โดยทั่วไปการตรวจสอบไฟล์เกมใน Steam แล้วเริ่ม Steam ใหม่จะช่วยแก้ไขได้ หากคุณใช้ม็อด ให้ปิดด้วยสวิตช์ “Mods” ใน Dota 2 Mod Manager',
    solo: 'ไม่สามารถค้นหาแมตช์ได้: เกมไม่ผ่านการตรวจสอบสำหรับการเล่นออนไลน์ ตรวจสอบไฟล์เกมใน Steam แล้วเริ่ม Steam ใหม่ หากคุณใช้ม็อด ให้ปิดด้วยสวิตช์ “Mods” ใน Dota 2 Mod Manager',
    party: 'ไม่สามารถค้นหาแมตช์ได้: เกมของผู้เล่นคนหนึ่งในปาร์ตี้ของคุณไม่ผ่านการตรวจสอบสำหรับการเล่นออนไลน์ ผู้เล่นคนนั้นควรตรวจสอบไฟล์เกมใน Steam เริ่ม Steam ใหม่ และปิดม็อดด้วยสวิตช์ “Mods” ใน Dota 2 Mod Manager',
  },
  turkish: {
    header: 'Oyun denetimi',
    warning: 'Oyun, çevrim içi oyun denetiminden geçemedi; bu yüzden maç arama çalışmayabilir. Genellikle oyun dosyalarını Steam’de doğrulamak ve Steam’i yeniden başlatmak işe yarar. Mod kullanıyorsan, onları Dota 2 Mod Manager’daki “Mods” anahtarıyla kapat.',
    solo: 'Maç arama kullanılamıyor: oyun, çevrim içi oyun denetiminden geçemedi. Oyun dosyalarını Steam’de doğrula ve Steam’i yeniden başlat. Mod kullanıyorsan, onları Dota 2 Mod Manager’daki “Mods” anahtarıyla kapat.',
    party: 'Maç arama kullanılamıyor: grubundaki oyunculardan birinde oyun, çevrim içi oyun denetiminden geçemedi. O oyuncu oyun dosyalarını Steam’de doğrulamalı, Steam’i yeniden başlatmalı ve modları Dota 2 Mod Manager’daki “Mods” anahtarıyla kapatmalı.',
  },
  vietnamese: {
    header: 'Kiểm tra trò chơi',
    warning: 'Trò chơi chưa vượt qua bước kiểm tra để chơi trực tuyến, nên việc tìm trận có thể không hoạt động. Thường thì kiểm tra tính toàn vẹn của tệp trò chơi trên Steam và khởi động lại Steam sẽ khắc phục được. Nếu bạn dùng mod, hãy tắt chúng bằng công tắc “Mods” trong Dota 2 Mod Manager.',
    solo: 'Không thể tìm trận: trò chơi chưa vượt qua bước kiểm tra để chơi trực tuyến. Hãy kiểm tra tính toàn vẹn của tệp trò chơi trên Steam và khởi động lại Steam. Nếu bạn dùng mod, hãy tắt chúng bằng công tắc “Mods” trong Dota 2 Mod Manager.',
    party: 'Không thể tìm trận: trò chơi của một người chơi trong nhóm bạn chưa vượt qua bước kiểm tra để chơi trực tuyến. Người đó nên kiểm tra tính toàn vẹn của tệp trò chơi trên Steam, khởi động lại Steam và tắt mod bằng công tắc “Mods” trong Dota 2 Mod Manager.',
  },
};

/** The game's own keys for the four strings: its localization files name them this way. */
const NOTICE_KEYS = {
  header: 'DOTA_VAC_Verification_Header',
  warning: 'DOTA_VAC_Warning_Header_Solo',
  solo: 'DOTA_VAC_Verification_Header_Solo',
  party: 'DOTA_VAC_Verification_Header_Party',
};

export { NOTICE_TEXTS, NOTICE_KEYS };
