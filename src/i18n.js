// App languages for the people in the field: superintendents, cleaners and
// property managers can use the app in English, French, Spanish, Italian,
// Portuguese or Brazilian Portuguese. Manager and admin screens stay English.
//
// Reports, emails, the weekly spreadsheet, remarks and notes are ALWAYS English:
// they're built on the server and never pass through here, and anything a person
// types is checked to be English (shared/english-only.js) whatever language the
// app is shown in.
//
// How it works: the app renders in English, then translateTree() swaps every
// text node / placeholder / label that exactly matches a phrase below (plus a few
// patterns for phrases with numbers in them). Unknown text -- building names,
// reading names, values, anything typed -- has no entry, so it's left alone.
// Paragraphs with markup inside (the tutorials) are translated whole with L().

export const LANGUAGES = [
  ["en", "English"],
  ["fr", "Français"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["pt-BR", "Português (Brasil)"],
];
const COLUMN = { fr: 0, es: 1, it: 2, pt: 3, "pt-BR": 4 };

// English: [French, Spanish, Italian, Portuguese (Portugal), Portuguese (Brazil)]
const PHRASES = {
  // Navigation and common buttons
  "Today": ["Aujourd'hui", "Hoy", "Oggi", "Hoje", "Hoje"],
  "History": ["Historique", "Historial", "Cronologia", "Histórico", "Histórico"],
  "How it works": ["Mode d'emploi", "Cómo funciona", "Come funziona", "Como funciona", "Como funciona"],
  "Overview": ["Aperçu", "Resumen", "Panoramica", "Visão geral", "Visão geral"],
  "Messages": ["Messages", "Mensajes", "Messaggi", "Mensagens", "Mensagens"],
  "Tasks": ["Tâches", "Tareas", "Attività", "Tarefas", "Tarefas"],
  "Cancel": ["Annuler", "Cancelar", "Annulla", "Cancelar", "Cancelar"],
  "Confirm": ["Confirmer", "Confirmar", "Conferma", "Confirmar", "Confirmar"],
  "Delete": ["Supprimer", "Eliminar", "Elimina", "Eliminar", "Excluir"],
  "Done": ["Terminé", "Listo", "Fatto", "Concluído", "Pronto"],
  "Loading…": ["Chargement…", "Cargando…", "Caricamento…", "A carregar…", "Carregando…"],
  "Sign out": ["Se déconnecter", "Cerrar sesión", "Esci", "Terminar sessão", "Sair"],
  "Dismiss": ["Fermer", "Cerrar", "Chiudi", "Fechar", "Fechar"],
  "Value": ["Valeur", "Valor", "Valore", "Valor", "Valor"],
  "Submitted": ["Envoyée", "Enviada", "Inviata", "Enviada", "Enviada"],
  "In progress": ["En cours", "En curso", "In corso", "Em curso", "Em andamento"],
  "Open": ["Ouvert", "Abierto", "Aperto", "Aberto", "Aberto"],
  "Resolved": ["Résolu", "Resuelto", "Risolto", "Resolvido", "Resolvido"],
  "Language": ["Langue", "Idioma", "Lingua", "Idioma", "Idioma"],

  // Sign in
  "Welcome back": ["Bon retour", "Bienvenido de nuevo", "Bentornato", "Bem-vindo de volta", "Bem-vindo de volta"],
  "Sign in with your Inspect Funnels account.": ["Connectez-vous avec votre compte Inspect Funnels.", "Inicia sesión con tu cuenta de Inspect Funnels.", "Accedi con il tuo account Inspect Funnels.", "Inicie sessão com a sua conta Inspect Funnels.", "Entre com sua conta do Inspect Funnels."],
  "Username": ["Nom d'utilisateur", "Usuario", "Nome utente", "Nome de utilizador", "Usuário"],
  "Password": ["Mot de passe", "Contraseña", "Password", "Palavra-passe", "Senha"],
  "Enter command center": ["Entrer", "Entrar", "Entra", "Entrar", "Entrar"],
  "Secure access": ["Accès sécurisé", "Acceso seguro", "Accesso sicuro", "Acesso seguro", "Acesso seguro"],
  "New here?": ["Nouveau ici ?", "¿Eres nuevo?", "Sei nuovo?", "É novo aqui?", "Novo por aqui?"],
  "Create an account": ["Créer un compte", "Crear una cuenta", "Crea un account", "Criar uma conta", "Criar uma conta"],
  "Property operations, clearly directed": ["Les opérations immobilières, clairement dirigées", "Operaciones de edificios, bien dirigidas", "Operazioni immobiliari, ben dirette", "Operações de edifícios, bem dirigidas", "Operações prediais, bem direcionadas"],
  "Operations platform online": ["Plateforme en ligne", "Plataforma en línea", "Piattaforma online", "Plataforma online", "Plataforma online"],
  "Invalid username or password": ["Nom d'utilisateur ou mot de passe invalide", "Usuario o contraseña incorrectos", "Nome utente o password non validi", "Nome de utilizador ou palavra-passe inválidos", "Usuário ou senha inválidos"],

  // Super home
  "Ready for today's inspection": ["Prêt pour l'inspection du jour", "Listo para la inspección de hoy", "Pronto per l'ispezione di oggi", "Pronto para a inspeção de hoje", "Pronto para a inspeção de hoje"],
  "Inspection in progress": ["Inspection en cours", "Inspección en curso", "Ispezione in corso", "Inspeção em curso", "Inspeção em andamento"],
  "Today's inspection is submitted": ["L'inspection du jour est envoyée", "La inspección de hoy está enviada", "L'ispezione di oggi è inviata", "A inspeção de hoje foi enviada", "A inspeção de hoje foi enviada"],
  "Start inspection": ["Commencer l'inspection", "Empezar la inspección", "Inizia l'ispezione", "Iniciar inspeção", "Iniciar inspeção"],
  "Continue where you left off": ["Reprendre là où vous étiez", "Continuar donde lo dejaste", "Riprendi da dove eri rimasto", "Continuar onde parou", "Continuar de onde parou"],
  "Review & submit": ["Vérifier et envoyer", "Revisar y enviar", "Controlla e invia", "Rever e enviar", "Revisar e enviar"],
  "Full checklist": ["Liste complète", "Lista completa", "Lista completa", "Lista completa", "Lista completa"],
  "Notices & notes": ["Avis et notes", "Avisos y notas", "Avvisi e note", "Avisos e notas", "Avisos e notas"],
  "Message my manager": ["Écrire à mon gestionnaire", "Escribir a mi gerente", "Scrivi al mio responsabile", "Escrever ao meu gestor", "Falar com meu gerente"],
  "For the first 3 inspection days it only watches. Enter exactly what each gauge shows — those values become what's normal for each machine, and after that anything different gets flagged.": [
    "Pendant les 3 premiers jours d'inspection, elle ne fait qu'observer. Entrez exactement ce que montre chaque jauge : ces valeurs deviennent la normale de chaque machine, et ensuite tout écart est signalé.",
    "Durante los primeros 3 días de inspección solo observa. Anota exactamente lo que marca cada indicador: esos valores pasan a ser lo normal de cada máquina y, después, cualquier diferencia se marca.",
    "Nei primi 3 giorni di ispezione si limita a osservare. Inserisci esattamente ciò che mostra ogni indicatore: quei valori diventano il normale di ogni macchina e poi ogni differenza viene segnalata.",
    "Nos primeiros 3 dias de inspeção apenas observa. Introduza exatamente o que cada indicador mostra — esses valores passam a ser o normal de cada máquina e, depois disso, qualquer diferença é assinalada.",
    "Nos primeiros 3 dias de inspeção ele só observa. Digite exatamente o que cada medidor mostra — esses valores viram o normal de cada máquina e, depois disso, qualquer diferença é sinalizada.",
  ],
  "No checklist has been set up for this building yet. Your area manager adds it.": ["Aucune liste n'est encore configurée pour cet immeuble. Votre gestionnaire de secteur l'ajoute.", "Todavía no hay lista para este edificio. La agrega tu gerente de zona.", "Non c'è ancora una lista per questo edificio. La aggiunge il tuo responsabile di zona.", "Ainda não há lista para este edifício. O seu gestor de área adiciona-a.", "Ainda não há checklist para este prédio. Seu gerente de área adiciona."],

  // Location / camera permission
  "Before you start": ["Avant de commencer", "Antes de empezar", "Prima di iniziare", "Antes de começar", "Antes de começar"],
  "Allow location and camera": ["Autoriser la localisation et l'appareil photo", "Permitir ubicación y cámara", "Consenti posizione e fotocamera", "Permitir localização e câmara", "Permitir localização e câmera"],
  "Allow location & camera": ["Autoriser localisation et caméra", "Permitir ubicación y cámara", "Consenti posizione e fotocamera", "Permitir localização e câmara", "Permitir localização e câmera"],
  "Waiting for your phone…": ["En attente de votre téléphone…", "Esperando a tu teléfono…", "In attesa del telefono…", "À espera do telemóvel…", "Aguardando o celular…"],

  // Command mode
  "← Exit command mode": ["← Quitter le mode commande", "← Salir del modo comando", "← Esci dalla modalità comando", "← Sair do modo comando", "← Sair do modo comando"],
  "A new version of Inspect Funnels is ready.": ["Une nouvelle version d'Inspect Funnels est prête.", "Hay una nueva versión de Inspect Funnels.", "È pronta una nuova versione di Inspect Funnels.", "Há uma nova versão do Inspect Funnels.", "Há uma nova versão do Inspect Funnels."],
  "Refresh": ["Actualiser", "Actualizar", "Aggiorna", "Atualizar", "Atualizar"],
  "Back": ["Retour", "Atrás", "Indietro", "Voltar", "Voltar"],
  "Sign in": ["Connexion", "Iniciar sesión", "Accedi", "Iniciar sessão", "Entrar"],
  "Go to sign in": ["Aller à la connexion", "Ir a iniciar sesión", "Vai all'accesso", "Ir para o início de sessão", "Ir para o login"],
  "← Exit": ["← Quitter", "← Salir", "← Esci", "← Sair", "← Sair"],
  "Clear all": ["Tout effacer", "Borrar todo", "Cancella tutto", "Limpar tudo", "Limpar tudo"],
  "← Back": ["← Retour", "← Atrás", "← Indietro", "← Voltar", "← Voltar"],
  "Flag for later": ["Signaler pour plus tard", "Marcar para después", "Segnala per dopo", "Marcar para depois", "Marcar para depois"],
  "Reading…": ["Lecture…", "Leyendo…", "Lettura…", "A ler…", "Lendo…"],
  "Retake": ["Reprendre", "Repetir", "Rifai", "Repetir", "Refazer"],
  "Enter manually": ["Saisir à la main", "Escribir a mano", "Inserisci a mano", "Introduzir à mão", "Digitar manualmente"],
  "Accept": ["Accepter", "Aceptar", "Accetta", "Aceitar", "Aceitar"],
  "Couldn't read a value in that photo.": ["Impossible de lire une valeur sur cette photo.", "No se pudo leer un valor en esa foto.", "Impossibile leggere un valore in quella foto.", "Não foi possível ler um valor nessa foto.", "Não deu para ler um valor nessa foto."],
  "Mistake — re-enter": ["Erreur — ressaisir", "Error — volver a escribir", "Errore — reinserisci", "Engano — introduzir de novo", "Erro — digitar de novo"],
  "It's normal": ["C'est normal", "Es normal", "È normale", "É normal", "É normal"],
  "It's abnormal": ["C'est anormal", "Es anormal", "È anomalo", "É anormal", "É anormal"],
  "It's the real reading": ["C'est la vraie valeur", "Es el valor real", "È la lettura reale", "É a leitura real", "É a leitura real"],
  "Mistake": ["Erreur", "Error", "Errore", "Engano", "Erro"],
  "\"It's normal\" teaches the machine this value right away. \"It's abnormal\" is reported when you submit.": [
    "« C'est normal » apprend cette valeur à la machine tout de suite. « C'est anormal » est signalé à l'envoi.",
    "«Es normal» enseña este valor a la máquina al momento. «Es anormal» se reporta al enviar.",
    "«È normale» insegna subito questo valore alla macchina. «È anomalo» viene segnalato all'invio.",
    "«É normal» ensina este valor à máquina na hora. «É anormal» é comunicado ao enviar.",
    "\"É normal\" ensina esse valor à máquina na hora. \"É anormal\" é reportado ao enviar.",
  ],
  "Required before moving on": ["Obligatoire avant de continuer", "Obligatorio antes de seguir", "Obbligatorio prima di proseguire", "Obrigatório antes de continuar", "Obrigatório antes de continuar"],
  "I'll do this later": ["Je le ferai plus tard", "Lo haré después", "Lo farò dopo", "Faço isto mais tarde", "Faço isso depois"],
  "Flagged items": ["Éléments signalés", "Elementos marcados", "Elementi segnalati", "Itens assinalados", "Itens sinalizados"],
  "Resolve": ["Régler", "Resolver", "Risolvi", "Resolver", "Resolver"],
  "Remark on this reading": ["Remarque sur cette valeur", "Comentario sobre esta lectura", "Nota su questa lettura", "Observação sobre esta leitura", "Observação sobre esta leitura"],
  "Write a remark about this reading": ["Écrire une remarque sur cette valeur", "Escribir un comentario sobre esta lectura", "Scrivi una nota su questa lettura", "Escrever uma observação sobre esta leitura", "Escrever uma observação sobre esta leitura"],
  "Save remark": ["Enregistrer la remarque", "Guardar comentario", "Salva nota", "Guardar observação", "Salvar observação"],
  "What's wrong or worth knowing? Write it in English.": ["Quel est le problème ? Écrivez-le en anglais.", "¿Qué pasa o qué conviene saber? Escríbelo en inglés.", "Cosa non va o cosa è utile sapere? Scrivilo in inglese.", "O que se passa ou convém saber? Escreva em inglês.", "O que está errado ou vale saber? Escreva em inglês."],
  "Saved with today's inspection and shown in the Friday report. When you submit, you can choose to send your remarks to your Area and Operations Managers.": [
    "Enregistrée avec l'inspection du jour et affichée dans le rapport du vendredi. À l'envoi, vous pouvez choisir de l'envoyer à vos gestionnaires de secteur et des opérations.",
    "Se guarda con la inspección de hoy y aparece en el informe del viernes. Al enviar, puedes elegir mandar tus comentarios a tus gerentes de zona y de operaciones.",
    "Salvata con l'ispezione di oggi e mostrata nel report del venerdì. All'invio puoi scegliere di mandare le note ai responsabili di zona e operativi.",
    "Guardada com a inspeção de hoje e mostrada no relatório de sexta. Ao enviar, pode escolher mandar as observações aos gestores de área e de operações.",
    "Salva com a inspeção de hoje e mostrada no relatório de sexta. Ao enviar, você pode escolher mandar as observações aos gerentes de área e de operações.",
  ],
  "Please write this in English. Remarks and notes go into reports, which must be in English.": [
    "Veuillez écrire en anglais. Les remarques et notes vont dans les rapports, qui doivent être en anglais.",
    "Escríbelo en inglés, por favor. Los comentarios y notas van a los informes, que deben estar en inglés.",
    "Scrivilo in inglese, per favore. Note e commenti finiscono nei report, che devono essere in inglese.",
    "Escreva em inglês, por favor. As observações e notas vão para os relatórios, que têm de estar em inglês.",
    "Escreva em inglês, por favor. As observações e notas vão para os relatórios, que precisam estar em inglês.",
  ],
  "Send to management": ["Envoyer à la direction", "Enviar a la gerencia", "Invia alla direzione", "Enviar à gestão", "Enviar à gerência"],
  "Keep in report only": ["Garder dans le rapport seulement", "Solo en el informe", "Solo nel report", "Manter só no relatório", "Manter só no relatório"],

  // Camera and photos
  "Take Inspection Photo": ["Photo d'inspection", "Foto de inspección", "Foto di ispezione", "Fotografia de inspeção", "Foto da inspeção"],
  "Take Photo": ["Prendre la photo", "Tomar foto", "Scatta foto", "Tirar foto", "Tirar foto"],
  "Take photo": ["Prendre une photo", "Tomar foto", "Scatta foto", "Tirar foto", "Tirar foto"],
  "Retake photo": ["Reprendre la photo", "Repetir foto", "Rifai foto", "Repetir foto", "Tirar de novo"],
  "Starting camera…": ["Démarrage de la caméra…", "Iniciando cámara…", "Avvio fotocamera…", "A iniciar a câmara…", "Abrindo a câmera…"],
  "Frame the equipment, then tap Take Photo.": ["Cadrez l'équipement, puis touchez Prendre la photo.", "Encuadra el equipo y toca Tomar foto.", "Inquadra l'apparecchio e tocca Scatta foto.", "Enquadre o equipamento e toque em Tirar foto.", "Enquadre o equipamento e toque em Tirar foto."],
  "Preparing photo…": ["Préparation de la photo…", "Preparando foto…", "Preparazione foto…", "A preparar a foto…", "Preparando a foto…"],
  "Photo Saved": ["Photo enregistrée", "Foto guardada", "Foto salvata", "Foto guardada", "Foto salva"],
  "Photo Not Saved": ["Photo non enregistrée", "Foto no guardada", "Foto non salvata", "Foto não guardada", "Foto não salva"],
  "Uploading photo…": ["Envoi de la photo…", "Subiendo foto…", "Caricamento foto…", "A enviar a foto…", "Enviando a foto…"],
  "Timestamp and location recorded.": ["Heure et position enregistrées.", "Hora y ubicación registradas.", "Ora e posizione registrate.", "Hora e localização registadas.", "Horário e localização registrados."],
  "Timestamp and location recorded. Checklist updated.": ["Heure et position enregistrées. Liste mise à jour.", "Hora y ubicación registradas. Lista actualizada.", "Ora e posizione registrate. Lista aggiornata.", "Hora e localização registadas. Lista atualizada.", "Horário e localização registrados. Lista atualizada."],
  "Checklist updated. Timestamp recorded; location unavailable.": ["Liste mise à jour. Heure enregistrée ; position indisponible.", "Lista actualizada. Hora registrada; ubicación no disponible.", "Lista aggiornata. Ora registrata; posizione non disponibile.", "Lista atualizada. Hora registada; localização indisponível.", "Lista atualizada. Horário registrado; localização indisponível."],
  "Timestamp recorded. Location unavailable — check location permission.": ["Heure enregistrée. Position indisponible — vérifiez l'autorisation de localisation.", "Hora registrada. Ubicación no disponible: revisa el permiso de ubicación.", "Ora registrata. Posizione non disponibile: controlla il permesso di posizione.", "Hora registada. Localização indisponível — verifique a permissão de localização.", "Horário registrado. Localização indisponível — confira a permissão de localização."],

  // Checklist form
  "Comments": ["Commentaires", "Comentarios", "Commenti", "Comentários", "Comentários"],
  "Anything the next shift should know…": ["Ce que la prochaine équipe doit savoir… (en anglais)", "Lo que debe saber el siguiente turno… (en inglés)", "Cosa deve sapere il turno successivo… (in inglese)", "O que o próximo turno deve saber… (em inglês)", "O que o próximo turno precisa saber… (em inglês)"],
  "Save draft": ["Enregistrer le brouillon", "Guardar borrador", "Salva bozza", "Guardar rascunho", "Salvar rascunho"],
  "Submit inspection": ["Envoyer l'inspection", "Enviar inspección", "Invia ispezione", "Enviar inspeção", "Enviar inspeção"],
  "Submitting…": ["Envoi…", "Enviando…", "Invio…", "A enviar…", "Enviando…"],
  "Command mode": ["Mode commande", "Modo comando", "Modalità comando", "Modo comando", "Modo comando"],
  "Double-check before submitting": ["Vérifiez avant d'envoyer", "Revisa antes de enviar", "Ricontrolla prima di inviare", "Verifique antes de enviar", "Confira antes de enviar"],
  "Confirm & submit": ["Confirmer et envoyer", "Confirmar y enviar", "Conferma e invia", "Confirmar e enviar", "Confirmar e enviar"],

  // Notices, issues
  "Your building": ["Votre immeuble", "Tu edificio", "Il tuo edificio", "O seu edifício", "Seu prédio"],
  "Notices from your operations manager": ["Avis de votre gestionnaire des opérations", "Avisos de tu gerente de operaciones", "Avvisi del responsabile operativo", "Avisos do seu gestor de operações", "Avisos do seu gerente de operações"],
  "Recent notes": ["Notes récentes", "Notas recientes", "Note recenti", "Notas recentes", "Notas recentes"],
  "Nothing posted yet.": ["Rien de publié pour l'instant.", "Nada publicado todavía.", "Ancora niente di pubblicato.", "Ainda nada publicado.", "Nada publicado ainda."],
  "Nothing left yet.": ["Rien pour l'instant.", "Nada todavía.", "Ancora niente.", "Ainda nada.", "Nada ainda."],
  "Need help with something else?": ["Besoin d'aide pour autre chose ?", "¿Necesitas ayuda con otra cosa?", "Ti serve aiuto per altro?", "Precisa de ajuda com outra coisa?", "Precisa de ajuda com outra coisa?"],
  "Not about a reading": ["Pas au sujet d'une valeur", "No es sobre una lectura", "Non riguarda una lettura", "Não é sobre uma leitura", "Não é sobre uma leitura"],
  "Flag an issue": ["Signaler un problème", "Reportar un problema", "Segnala un problema", "Comunicar um problema", "Relatar um problema"],
  "Flag an issue for your operations manager": ["Signaler un problème à votre gestionnaire des opérations", "Reportar un problema a tu gerente de operaciones", "Segnala un problema al responsabile operativo", "Comunicar um problema ao gestor de operações", "Relatar um problema ao gerente de operações"],
  "What kind of issue?": ["Quel type de problème ?", "¿Qué tipo de problema?", "Che tipo di problema?", "Que tipo de problema?", "Que tipo de problema?"],
  "Describe it": ["Décrivez-le (en anglais)", "Descríbelo (en inglés)", "Descrivilo (in inglese)", "Descreva (em inglês)", "Descreva (em inglês)"],
  "Send to operations manager": ["Envoyer au gestionnaire des opérations", "Enviar al gerente de operaciones", "Invia al responsabile operativo", "Enviar ao gestor de operações", "Enviar ao gerente de operações"],
  "Sent to your operations manager.": ["Envoyé à votre gestionnaire des opérations.", "Enviado a tu gerente de operaciones.", "Inviato al responsabile operativo.", "Enviado ao seu gestor de operações.", "Enviado ao seu gerente de operações."],
  "Inventory": ["Inventaire", "Inventario", "Inventario", "Inventário", "Estoque"],
  "Chemicals / supplies": ["Produits / fournitures", "Químicos / suministros", "Prodotti / forniture", "Químicos / material", "Produtos / materiais"],
  "Schedule question": ["Question d'horaire", "Pregunta de horario", "Domanda sull'orario", "Dúvida de horário", "Dúvida de horário"],
  "Method / procedure question": ["Question de méthode", "Pregunta de método", "Domanda sul metodo", "Dúvida de método", "Dúvida de procedimento"],
  "Something else": ["Autre chose", "Otra cosa", "Altro", "Outra coisa", "Outra coisa"],
  "No submitted inspections yet.": ["Aucune inspection envoyée pour l'instant.", "Todavía no hay inspecciones enviadas.", "Ancora nessuna ispezione inviata.", "Ainda não há inspeções enviadas.", "Nenhuma inspeção enviada ainda."],
  "Photo library": ["Photothèque", "Fotos", "Archivio foto", "Fotografias", "Galeria de fotos"],
  "Open library": ["Ouvrir", "Abrir", "Apri", "Abrir", "Abrir"],

  // Cleaners
  "Tasks aren't turned on for your account": ["Les tâches ne sont pas activées pour votre compte", "Las tareas no están activadas en tu cuenta", "Le attività non sono attive per il tuo account", "As tarefas não estão ativas na sua conta", "As tarefas não estão ativadas na sua conta"],
  "Ask your manager if you should have access to the daily task checklist.": ["Demandez à votre gestionnaire si vous devez avoir accès à la liste des tâches.", "Pregunta a tu gerente si deberías tener acceso a la lista de tareas.", "Chiedi al tuo responsabile se devi avere accesso alla lista delle attività.", "Pergunte ao seu gestor se deve ter acesso à lista de tarefas.", "Pergunte ao seu gerente se você deve ter acesso à lista de tarefas."],

  // Property manager
  "Today's inspection": ["L'inspection du jour", "La inspección de hoy", "L'ispezione di oggi", "A inspeção de hoje", "A inspeção de hoje"],
  "Today's inspection is done": ["L'inspection du jour est faite", "La inspección de hoy está hecha", "L'ispezione di oggi è fatta", "A inspeção de hoje está feita", "A inspeção de hoje está feita"],
  "Not started yet today.": ["Pas encore commencée aujourd'hui.", "Todavía no empezó hoy.", "Non ancora iniziata oggi.", "Ainda não começou hoje.", "Ainda não começou hoje."],
  "Needs your attention": ["À surveiller", "Requiere tu atención", "Richiede attenzione", "Requer a sua atenção", "Precisa da sua atenção"],
  "Readings outside normal": ["Valeurs hors normale", "Lecturas fuera de lo normal", "Letture fuori norma", "Leituras fora do normal", "Leituras fora do normal"],
  "Last 14 days": ["14 derniers jours", "Últimos 14 días", "Ultimi 14 giorni", "Últimos 14 dias", "Últimos 14 dias"],
  "Last 60 days": ["60 derniers jours", "Últimos 60 días", "Ultimi 60 giorni", "Últimos 60 dias", "Últimos 60 dias"],
  "Nothing has been outside normal in the last 14 days.": ["Rien n'a été hors normale ces 14 derniers jours.", "Nada ha estado fuera de lo normal en los últimos 14 días.", "Niente fuori norma negli ultimi 14 giorni.", "Nada esteve fora do normal nos últimos 14 dias.", "Nada ficou fora do normal nos últimos 14 dias."],
  "Inspection log": ["Journal des inspections", "Registro de inspecciones", "Registro ispezioni", "Registo de inspeções", "Registro de inspeções"],
  "Date": ["Date", "Fecha", "Data", "Data", "Data"],
  "Status": ["Statut", "Estado", "Stato", "Estado", "Status"],
  "Started": ["Commencée", "Inicio", "Iniziata", "Início", "Início"],
  "Outcome": ["Résultat", "Resultado", "Esito", "Resultado", "Resultado"],
  "Normal": ["Normal", "Normal", "Normale", "Normal", "Normal"],
  "Needs a look": ["À vérifier", "Revisar", "Da controllare", "A verificar", "Verificar"],
  "Abnormal": ["Anormal", "Anormal", "Anomalo", "Anormal", "Anormal"],
  "Not evaluated": ["Non évalué", "Sin evaluar", "Non valutato", "Não avaliado", "Não avaliado"],
  "Called abnormal": ["Jugé anormal", "Marcado anormal", "Indicato anomalo", "Indicado anormal", "Marcado como anormal"],
  "Called normal": ["Jugé normal", "Marcado normal", "Indicato normale", "Indicado normal", "Marcado como normal"],
  "No answer": ["Sans réponse", "Sin respuesta", "Nessuna risposta", "Sem resposta", "Sem resposta"],
  "From your superintendent": ["De votre surintendant", "De tu encargado", "Dal tuo custode", "Do seu encarregado", "Do seu zelador"],
  "Observation": ["Observation", "Observación", "Osservazione", "Observação", "Observação"],
  "Issue flagged": ["Problème signalé", "Problema reportado", "Problema segnalato", "Problema comunicado", "Problema relatado"],
  "Abnormal reading": ["Valeur anormale", "Lectura anormal", "Lettura anomala", "Leitura anormal", "Leitura anormal"],
  "No inspections yet": ["Pas encore d'inspection", "Todavía no hay inspecciones", "Ancora nessuna ispezione", "Ainda não há inspeções", "Nenhuma inspeção ainda"],
};

// Whole paragraphs with markup inside: the tutorials and the permission screen.
Object.assign(PHRASES, {
  "For superintendents": ["Pour les surintendants", "Para encargados", "Per i custodi", "Para encarregados", "Para zeladores"],
  "For property managers": ["Pour les gestionnaires immobiliers", "Para administradores de propiedad", "Per gli amministratori", "Para administradores do imóvel", "Para administradores do imóvel"],
  "How Inspect Funnels works": ["Comment fonctionne Inspect Funnels", "Cómo funciona Inspect Funnels", "Come funziona Inspect Funnels", "Como funciona o Inspect Funnels", "Como funciona o Inspect Funnels"],
  "Every machine photo records when and where it was taken, as proof the inspection was done on site. Tap the button below and choose <strong>Allow</strong> when your phone asks.": [
    "Chaque photo de machine enregistre l'heure et le lieu, comme preuve que l'inspection a été faite sur place. Touchez le bouton ci-dessous et choisissez <strong>Autoriser</strong> quand le téléphone le demande.",
    "Cada foto de máquina registra cuándo y dónde se tomó, como prueba de que la inspección se hizo en el sitio. Toca el botón de abajo y elige <strong>Permitir</strong> cuando el teléfono pregunte.",
    "Ogni foto della macchina registra quando e dove è stata scattata, come prova che l'ispezione è stata fatta sul posto. Tocca il pulsante qui sotto e scegli <strong>Consenti</strong> quando il telefono lo chiede.",
    "Cada fotografia de máquina regista quando e onde foi tirada, como prova de que a inspeção foi feita no local. Toque no botão abaixo e escolha <strong>Permitir</strong> quando o telemóvel perguntar.",
    "Cada foto de máquina registra quando e onde foi tirada, como prova de que a inspeção foi feita no local. Toque no botão abaixo e escolha <strong>Permitir</strong> quando o celular perguntar.",
  ],
  "Start your inspection": ["Commencez votre inspection", "Empieza tu inspección", "Inizia l'ispezione", "Comece a inspeção", "Comece a inspeção"],
  "Tap <strong>Start inspection</strong>. It walks you through every reading in your walk order, one at a time. Type what the gauge shows.": [
    "Touchez <strong>Commencer l'inspection</strong>. L'application vous guide valeur par valeur, dans l'ordre de votre tournée. Tapez ce qu'indique la jauge.",
    "Toca <strong>Empezar la inspección</strong>. Te guía lectura por lectura, en el orden de tu recorrido. Escribe lo que marca el indicador.",
    "Tocca <strong>Inizia l'ispezione</strong>. Ti guida lettura per lettura, nell'ordine del tuo giro. Scrivi ciò che mostra l'indicatore.",
    "Toque em <strong>Iniciar inspeção</strong>. Guia-o leitura a leitura, pela ordem do seu percurso. Escreva o que o indicador mostra.",
    "Toque em <strong>Iniciar inspeção</strong>. Ele guia você leitura por leitura, na ordem da sua ronda. Digite o que o medidor mostra.",
  ],
  "Take the machine photo": ["Prenez la photo de la machine", "Toma la foto de la máquina", "Scatta la foto della macchina", "Tire a fotografia da máquina", "Tire a foto da máquina"],
  "At the end of each machine you take one photo. It records the time and your location as proof you were there, so keep location on.": [
    "À la fin de chaque machine, vous prenez une photo. Elle enregistre l'heure et votre position comme preuve de votre passage : gardez la localisation activée.",
    "Al terminar cada máquina tomas una foto. Registra la hora y tu ubicación como prueba de que estuviste ahí, así que deja la ubicación activada.",
    "Alla fine di ogni macchina scatti una foto. Registra l'ora e la tua posizione come prova che eri lì, quindi tieni attiva la posizione.",
    "No fim de cada máquina tira uma fotografia. Regista a hora e a sua localização como prova de que esteve lá, por isso mantenha a localização ligada.",
    "No fim de cada máquina você tira uma foto. Ela registra o horário e sua localização como prova de que você esteve lá, então mantenha a localização ligada.",
  ],
  "The first 3 days: be 100% genuine": ["Les 3 premiers jours : soyez 100 % exact", "Los primeros 3 días: sé 100 % fiel", "I primi 3 giorni: sii preciso al 100%", "Os primeiros 3 dias: seja 100% fiel", "Os primeiros 3 dias: seja 100% fiel"],
  "For the first 3 inspection days the app only listens. It learns what is normal for every machine from exactly what you enter, separately for On, Off and Auto. Enter the real values, never a guess.": [
    "Pendant les 3 premiers jours d'inspection, l'application ne fait qu'écouter. Elle apprend la normale de chaque machine à partir de ce que vous entrez, séparément pour Marche, Arrêt et Auto. Entrez les vraies valeurs, jamais une estimation.",
    "Durante los primeros 3 días de inspección la app solo escucha. Aprende lo normal de cada máquina a partir de lo que anotas, por separado para Encendido, Apagado y Auto. Anota los valores reales, nunca un cálculo a ojo.",
    "Nei primi 3 giorni di ispezione l'app ascolta soltanto. Impara il normale di ogni macchina da ciò che inserisci, separatamente per Acceso, Spento e Auto. Inserisci i valori reali, mai una stima.",
    "Nos primeiros 3 dias de inspeção a app apenas ouve. Aprende o normal de cada máquina a partir do que introduz, separadamente para Ligado, Desligado e Auto. Introduza os valores reais, nunca um palpite.",
    "Nos primeiros 3 dias de inspeção o app só escuta. Ele aprende o normal de cada máquina a partir do que você digita, separado para Ligado, Desligado e Auto. Digite os valores reais, nunca um chute.",
  ],
  "After that, it flags anything different": ["Ensuite, tout écart est signalé", "Después, marca cualquier diferencia", "Poi segnala ogni differenza", "Depois, assinala qualquer diferença", "Depois, sinaliza qualquer diferença"],
  "Once it has learned, any reading below the lowest or above the highest value that machine has actually shown is flagged right away.": [
    "Une fois l'apprentissage fait, toute valeur sous la plus basse ou au-dessus de la plus haute réellement observée sur cette machine est signalée immédiatement.",
    "Cuando ya aprendió, cualquier lectura por debajo de la más baja o por encima de la más alta que esa máquina haya marcado se marca al instante.",
    "Una volta imparato, ogni lettura sotto la più bassa o sopra la più alta mai registrata da quella macchina viene segnalata subito.",
    "Depois de aprender, qualquer leitura abaixo da mais baixa ou acima da mais alta que essa máquina já mostrou é assinalada de imediato.",
    "Depois de aprender, qualquer leitura abaixo da mais baixa ou acima da mais alta que essa máquina já mostrou é sinalizada na hora.",
  ],
  "When a reading is flagged": ["Quand une valeur est signalée", "Cuando se marca una lectura", "Quando una lettura è segnalata", "Quando uma leitura é assinalada", "Quando uma leitura é sinalizada"],
  "<strong>Mistake</strong>: you typed it wrong, so re-enter it. <strong>It's normal</strong>: the app learns this value on the spot and won't flag it again. <strong>It's abnormal</strong>: it is reported to your property manager when you submit.": [
    "<strong>Erreur</strong> : vous avez mal tapé, ressaisissez. <strong>C'est normal</strong> : l'application apprend cette valeur tout de suite et ne la signalera plus. <strong>C'est anormal</strong> : elle est signalée à votre gestionnaire immobilier à l'envoi.",
    "<strong>Error</strong>: lo escribiste mal, vuelve a anotarlo. <strong>Es normal</strong>: la app aprende este valor al momento y no lo volverá a marcar. <strong>Es anormal</strong>: se reporta a tu administrador al enviar.",
    "<strong>Errore</strong>: hai scritto male, reinseriscilo. <strong>È normale</strong>: l'app impara subito questo valore e non lo segnalerà più. <strong>È anomalo</strong>: viene segnalato all'amministratore all'invio.",
    "<strong>Engano</strong>: escreveu mal, introduza de novo. <strong>É normal</strong>: a app aprende este valor na hora e não o volta a assinalar. <strong>É anormal</strong>: é comunicado ao administrador ao enviar.",
    "<strong>Erro</strong>: você digitou errado, digite de novo. <strong>É normal</strong>: o app aprende esse valor na hora e não sinaliza de novo. <strong>É anormal</strong>: é reportado ao administrador ao enviar.",
  ],
  "Leave a remark": ["Laissez une remarque", "Deja un comentario", "Lascia una nota", "Deixe uma observação", "Deixe uma observação"],
  "Tap the <strong>pencil</strong> (top right) to write a note about any reading, in English. When you submit, you choose whether your remarks go to your Area and Operations Managers.": [
    "Touchez le <strong>crayon</strong> (en haut à droite) pour écrire une note sur une valeur, en anglais. À l'envoi, vous choisissez si vos remarques vont à vos gestionnaires de secteur et des opérations.",
    "Toca el <strong>lápiz</strong> (arriba a la derecha) para escribir una nota sobre cualquier lectura, en inglés. Al enviar, eliges si tus comentarios van a tus gerentes de zona y de operaciones.",
    "Tocca la <strong>matita</strong> (in alto a destra) per scrivere una nota su una lettura, in inglese. All'invio scegli se mandare le note ai responsabili di zona e operativi.",
    "Toque no <strong>lápis</strong> (canto superior direito) para escrever uma nota sobre uma leitura, em inglês. Ao enviar, escolhe se as observações vão para os gestores de área e de operações.",
    "Toque no <strong>lápis</strong> (canto superior direito) para escrever uma nota sobre uma leitura, em inglês. Ao enviar, você escolhe se as observações vão para os gerentes de área e de operações.",
  ],
  "Lost signal? Closed the app?": ["Plus de réseau ? Application fermée ?", "¿Sin señal? ¿Cerraste la app?", "Niente segnale? App chiusa?", "Sem rede? Fechou a app?", "Sem sinal? Fechou o app?"],
  "Just open it again and tap <strong>Continue where you left off</strong>. It goes back to the exact reading you were on.": [
    "Rouvrez-la et touchez <strong>Reprendre là où vous étiez</strong>. Elle revient exactement à la valeur où vous étiez.",
    "Vuelve a abrirla y toca <strong>Continuar donde lo dejaste</strong>. Regresa a la lectura exacta donde estabas.",
    "Riaprila e tocca <strong>Riprendi da dove eri rimasto</strong>. Torna esattamente alla lettura dove eri.",
    "Abra de novo e toque em <strong>Continuar onde parou</strong>. Volta à leitura exata onde estava.",
    "Abra de novo e toque em <strong>Continuar de onde parou</strong>. Ele volta exatamente para a leitura onde você estava.",
  ],
  "Submit": ["Envoyer", "Enviar", "Invia", "Enviar", "Enviar"],
  "When every reading and photo is done, tap <strong>Review &amp; submit</strong>. After that, today is locked; your area manager can reopen it.": [
    "Quand toutes les valeurs et photos sont faites, touchez <strong>Vérifier et envoyer</strong>. Ensuite, la journée est verrouillée ; votre gestionnaire de secteur peut la rouvrir.",
    "Cuando termines todas las lecturas y fotos, toca <strong>Revisar y enviar</strong>. Después, el día queda bloqueado; tu gerente de zona puede reabrirlo.",
    "Quando hai finito letture e foto, tocca <strong>Controlla e invia</strong>. Poi la giornata è bloccata; il responsabile di zona può riaprirla.",
    "Quando todas as leituras e fotografias estiverem feitas, toque em <strong>Rever e enviar</strong>. Depois, o dia fica bloqueado; o seu gestor de área pode reabri-lo.",
    "Quando todas as leituras e fotos estiverem feitas, toque em <strong>Revisar e enviar</strong>. Depois, o dia fica bloqueado; seu gerente de área pode reabrir.",
  ],
  "What this is": ["De quoi s'agit-il", "Qué es esto", "Che cos'è", "O que é", "O que é"],
  "A read-only view of your building's daily mechanical inspection. You never fill anything in.": [
    "Une vue en lecture seule de l'inspection mécanique quotidienne de votre immeuble. Vous ne remplissez rien.",
    "Una vista de solo lectura de la inspección mecánica diaria de tu edificio. No tienes que llenar nada.",
    "Una vista in sola lettura dell'ispezione meccanica giornaliera del tuo edificio. Non devi compilare nulla.",
    "Uma vista só de leitura da inspeção mecânica diária do seu edifício. Não preenche nada.",
    "Uma visão só de leitura da inspeção mecânica diária do seu prédio. Você não preenche nada.",
  ],
  "What the superintendent does": ["Ce que fait le surintendant", "Qué hace el encargado", "Cosa fa il custode", "O que faz o encarregado", "O que o zelador faz"],
  "Every inspection day the superintendent walks the building, enters every gauge reading (boilers, pumps, pressures, levels), and takes a timestamped, location-tagged photo of each machine as proof it was done on site.": [
    "Chaque jour d'inspection, le surintendant parcourt l'immeuble, entre chaque valeur (chaudières, pompes, pressions, niveaux) et prend une photo horodatée et géolocalisée de chaque machine, preuve que c'est fait sur place.",
    "Cada día de inspección el encargado recorre el edificio, anota cada lectura (calderas, bombas, presiones, niveles) y toma una foto con hora y ubicación de cada máquina como prueba de que se hizo en el sitio.",
    "Ogni giorno di ispezione il custode gira l'edificio, inserisce ogni lettura (caldaie, pompe, pressioni, livelli) e scatta una foto con ora e posizione di ogni macchina come prova che è stato fatto sul posto.",
    "Em cada dia de inspeção o encarregado percorre o edifício, introduz cada leitura (caldeiras, bombas, pressões, níveis) e tira uma fotografia com hora e localização de cada máquina como prova de que foi feito no local.",
    "Em cada dia de inspeção o zelador percorre o prédio, digita cada leitura (caldeiras, bombas, pressões, níveis) e tira uma foto com horário e localização de cada máquina como prova de que foi feito no local.",
  ],
  "How readings are judged": ["Comment les valeurs sont évaluées", "Cómo se evalúan las lecturas", "Come vengono valutate le letture", "Como as leituras são avaliadas", "Como as leituras são avaliadas"],
  "For the first 3 days the app learns each machine's normal from the superintendent's real readings. After that, anything outside what that machine has actually read is flagged, and the superintendent answers: a typo, normal, or abnormal.": [
    "Pendant les 3 premiers jours, l'application apprend la normale de chaque machine à partir des vraies valeurs. Ensuite, tout ce qui sort de ce que la machine a réellement affiché est signalé, et le surintendant répond : erreur de saisie, normal ou anormal.",
    "Durante los primeros 3 días la app aprende lo normal de cada máquina con las lecturas reales del encargado. Después, todo lo que salga de lo que esa máquina ha marcado se marca, y el encargado responde: error, normal o anormal.",
    "Nei primi 3 giorni l'app impara il normale di ogni macchina dalle letture reali del custode. Poi tutto ciò che esce da quanto la macchina ha davvero registrato viene segnalato e il custode risponde: errore, normale o anomalo.",
    "Nos primeiros 3 dias a app aprende o normal de cada máquina com as leituras reais do encarregado. Depois, tudo o que sair do que essa máquina já mostrou é assinalado e o encarregado responde: engano, normal ou anormal.",
    "Nos primeiros 3 dias o app aprende o normal de cada máquina com as leituras reais do zelador. Depois, tudo o que sair do que essa máquina já mostrou é sinalizado e o zelador responde: erro de digitação, normal ou anormal.",
  ],
  "<strong>Today</strong> shows whether today's inspection is done. <strong>Readings outside normal</strong> lists every flagged reading from the last 14 days with the superintendent's answer and remark. The <strong>log</strong> shows when each inspection started and was submitted.": [
    "<strong>Aujourd'hui</strong> indique si l'inspection du jour est faite. <strong>Valeurs hors normale</strong> liste chaque valeur signalée des 14 derniers jours avec la réponse et la remarque du surintendant. Le <strong>journal</strong> montre quand chaque inspection a commencé et a été envoyée.",
    "<strong>Hoy</strong> muestra si la inspección de hoy está hecha. <strong>Lecturas fuera de lo normal</strong> lista cada lectura marcada de los últimos 14 días con la respuesta y el comentario del encargado. El <strong>registro</strong> muestra cuándo empezó y se envió cada inspección.",
    "<strong>Oggi</strong> mostra se l'ispezione di oggi è fatta. <strong>Letture fuori norma</strong> elenca ogni lettura segnalata degli ultimi 14 giorni con risposta e nota del custode. Il <strong>registro</strong> mostra quando ogni ispezione è iniziata ed è stata inviata.",
    "<strong>Hoje</strong> mostra se a inspeção de hoje está feita. <strong>Leituras fora do normal</strong> lista cada leitura assinalada dos últimos 14 dias com a resposta e a observação do encarregado. O <strong>registo</strong> mostra quando cada inspeção começou e foi enviada.",
    "<strong>Hoje</strong> mostra se a inspeção de hoje está feita. <strong>Leituras fora do normal</strong> lista cada leitura sinalizada dos últimos 14 dias com a resposta e a observação do zelador. O <strong>registro</strong> mostra quando cada inspeção começou e foi enviada.",
  ],
  "Issues the superintendent flagged, observations they chose to send, and readings they called abnormal. You also get an email for every abnormal reading.": [
    "Les problèmes signalés par le surintendant, les observations qu'il a envoyées et les valeurs jugées anormales. Vous recevez aussi un courriel pour chaque valeur anormale.",
    "Los problemas que reportó el encargado, las observaciones que decidió enviar y las lecturas que marcó como anormales. También recibes un correo por cada lectura anormal.",
    "I problemi segnalati dal custode, le osservazioni che ha scelto di inviare e le letture indicate come anomale. Ricevi anche un'email per ogni lettura anomala.",
    "Os problemas que o encarregado comunicou, as observações que decidiu enviar e as leituras que indicou como anormais. Também recebe um email por cada leitura anormal.",
    "Os problemas que o zelador relatou, as observações que ele escolheu enviar e as leituras que marcou como anormais. Você também recebe um e-mail para cada leitura anormal.",
  ],
  "What to do about an abnormal reading": ["Que faire d'une valeur anormale", "Qué hacer con una lectura anormal", "Cosa fare con una lettura anomala", "O que fazer com uma leitura anormal", "O que fazer com uma leitura anormal"],
  "Read the remark, then contact your Area Manager (or the superintendent) to arrange a check or a service call. The Area and Operations Managers get the same information and the Friday report.": [
    "Lisez la remarque, puis contactez votre gestionnaire de secteur (ou le surintendant) pour organiser une vérification ou un appel de service. Les gestionnaires de secteur et des opérations reçoivent la même information et le rapport du vendredi.",
    "Lee el comentario y luego contacta a tu gerente de zona (o al encargado) para organizar una revisión o una visita técnica. Los gerentes de zona y de operaciones reciben la misma información y el informe del viernes.",
    "Leggi la nota, poi contatta il responsabile di zona (o il custode) per organizzare un controllo o un intervento. I responsabili di zona e operativi ricevono le stesse informazioni e il report del venerdì.",
    "Leia a observação e contacte o seu gestor de área (ou o encarregado) para marcar uma verificação ou uma assistência. Os gestores de área e de operações recebem a mesma informação e o relatório de sexta.",
    "Leia a observação e fale com seu gerente de área (ou com o zelador) para marcar uma verificação ou uma visita técnica. Os gerentes de área e de operações recebem a mesma informação e o relatório de sexta.",
  ],
});

// Phrases with numbers or names in them. Each: [regex, (match) => [fr, es, it, pt, br]]
const PATTERNS = [
  [/^(\d+) of (\d+) readings · (\d+) of (\d+) machine photos$/, (m) => [
    `${m[1]} sur ${m[2]} valeurs · ${m[3]} sur ${m[4]} photos`, `${m[1]} de ${m[2]} lecturas · ${m[3]} de ${m[4]} fotos`, `${m[1]} di ${m[2]} letture · ${m[3]} di ${m[4]} foto`,
    `${m[1]} de ${m[2]} leituras · ${m[3]} de ${m[4]} fotos`, `${m[1]} de ${m[2]} leituras · ${m[3]} de ${m[4]} fotos`]],
  [/^(\d+) of (\d+) readings$/, (m) => [`${m[1]} sur ${m[2]} valeurs`, `${m[1]} de ${m[2]} lecturas`, `${m[1]} di ${m[2]} letture`, `${m[1]} de ${m[2]} leituras`, `${m[1]} de ${m[2]} leituras`]],
  [/^(\d+) of (\d+) · (\d+) done$/, (m) => [`${m[1]} sur ${m[2]} · ${m[3]} faites`, `${m[1]} de ${m[2]} · ${m[3]} hechas`, `${m[1]} di ${m[2]} · ${m[3]} fatte`, `${m[1]} de ${m[2]} · ${m[3]} feitas`, `${m[1]} de ${m[2]} · ${m[3]} feitas`]],
  [/^You left (\d+) remarks?$/, (m) => [`Vous avez laissé ${m[1]} remarque(s)`, `Dejaste ${m[1]} comentario(s)`, `Hai lasciato ${m[1]} nota/e`, `Deixou ${m[1]} observação(ões)`, `Você deixou ${m[1]} observação(ões)`]],
  [/^The app is still learning (\d+) readings?\.$/, (m) => [`L'application apprend encore ${m[1]} valeur(s).`, `La app todavía está aprendiendo ${m[1]} lectura(s).`, `L'app sta ancora imparando ${m[1]} lettura/e.`, `A app ainda está a aprender ${m[1]} leitura(s).`, `O app ainda está aprendendo ${m[1]} leitura(s).`]],
  [/^The app is still learning this building\.$/, () => ["L'application apprend encore cet immeuble.", "La app todavía está aprendiendo este edificio.", "L'app sta ancora imparando questo edificio.", "A app ainda está a aprender este edifício.", "O app ainda está aprendendo este prédio."]],
  [/^Normal for this machine(?: when (\S+))? is (.+); this is ([\d.]+) (above|below)\.?$/, (m) => {
    const up = m[4] === "above";
    const w = m[1] ? ` (${m[1]})` : "";
    return [
      `Normal pour cette machine${w} : ${m[2]} ; ${m[3]} ${up ? "au-dessus" : "en dessous"}.`,
      `Lo normal en esta máquina${w} es ${m[2]}; esto está ${m[3]} ${up ? "por encima" : "por debajo"}.`,
      `Il normale per questa macchina${w} è ${m[2]}; questo è ${m[3]} ${up ? "sopra" : "sotto"}.`,
      `O normal desta máquina${w} é ${m[2]}; isto está ${m[3]} ${up ? "acima" : "abaixo"}.`,
      `O normal desta máquina${w} é ${m[2]}; isso está ${m[3]} ${up ? "acima" : "abaixo"}.`,
    ];
  }],
  [/^Unit: (.+)$/, (m) => [`Unité : ${m[1]}`, `Unidad: ${m[1]}`, `Unità: ${m[1]}`, `Unidade: ${m[1]}`, `Unidade: ${m[1]}`]],
  [/^Expected: (.+)$/, (m) => [`Attendu : ${m[1]}`, `Esperado: ${m[1]}`, `Previsto: ${m[1]}`, `Esperado: ${m[1]}`, `Esperado: ${m[1]}`]],
  [/^In progress · (\d+) of (\d+) readings so far$/, (m) => [`En cours · ${m[1]} sur ${m[2]} valeurs`, `En curso · ${m[1]} de ${m[2]} lecturas`, `In corso · ${m[1]} di ${m[2]} letture`, `Em curso · ${m[1]} de ${m[2]} leituras`, `Em andamento · ${m[1]} de ${m[2]} leituras`]],
];

let current = "en";
try {
  current = localStorage.getItem("if-lang") || "en";
} catch {}
if (!COLUMN[current] && current !== "en") current = "en";

export const currentLanguage = () => current;

export function setLanguage(lang) {
  current = COLUMN[lang] != null ? lang : "en";
  try {
    localStorage.setItem("if-lang", current);
  } catch {}
}

// Translate one English phrase (or tutorial paragraph, markup and all).
export function L(text) {
  if (current === "en") return text;
  const row = PHRASES[text];
  if (row) return row[COLUMN[current]];
  for (const [re, fn] of PATTERNS) {
    const m = String(text).match(re);
    if (m) return fn(m)[COLUMN[current]];
  }
  return text;
}

const ATTRS = ["placeholder", "aria-label", "title"];

// Swap every translatable text node and attribute under `root`. Anything inside
// [data-no-translate] (names, values, what people typed) is skipped.
export function translateTree(root) {
  if (current === "en" || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-no-translate], textarea, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) continue;
    const out = L(trimmed);
    if (out !== trimmed) node.nodeValue = raw.replace(trimmed, out);
  }
  const elements = root.querySelectorAll ? root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")) : [];
  for (const el of elements) {
    if (el.closest("[data-no-translate]")) continue;
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (value) {
        const out = L(value.trim());
        if (out !== value.trim()) el.setAttribute(attr, out);
      }
    }
  }
}

// Keep translating whatever the app draws (screens, modals, the camera, toasts).
export function installTranslator(shouldTranslate) {
  const run = (node) => {
    if (shouldTranslate()) translateTree(node.nodeType === 1 ? node : node.parentElement);
  };
  new MutationObserver((mutations) => {
    for (const m of mutations) for (const node of m.addedNodes) run(node);
  }).observe(document.body, { childList: true, subtree: true });
  document.documentElement.lang = current;
}
