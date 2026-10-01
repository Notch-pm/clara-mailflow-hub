# Vision produit & parcours utilisateur

> Source : cadrage fonctionnel métier du 2026-07-21. Ce document décrit le **pourquoi** et les parcours critiques ; les détails techniques restent dans `docs/features.md`, `docs/routes.md`, `docs/data-model.md` et `docs/security.md`.

## Problème adressé

Clara est une solution de gestion du courrier destinée aux **collectivités publiques françaises** : mairies, agglomérations, départements et autres organismes publics.

Chaque semaine, ces organisations reçoivent des dizaines voire des centaines de « courriers » au sens métier :

- courrier papier ;
- emails ;
- formulaires « contactez-nous » ;
- messages ou sollicitations provenant d'autres canaux, par exemple réseaux sociaux ou téléphone, dès lors qu'un agent les saisit ou les rattache dans Clara.

Ces courriers portent souvent une ou plusieurs demandes d'action, un avis, une réclamation, une alerte ou une demande de suivi. Ils émanent fréquemment d'usagers, d'électeurs, d'associations, d'entreprises ou de partenaires institutionnels. Leur traitement est donc sensible pour les élus et les directions : une réponse perdue, tardive ou mal coordonnée peut devenir un problème politique, opérationnel ou juridique.

Dans beaucoup de collectivités, ces courriers sont encore mal suivis : ils circulent entre services, se perdent dans les boîtes mails, reposent sur des fichiers bureautiques ou nécessitent de nombreux échanges de coordination. Clara vise à centraliser le courrier, le qualifier, l'affecter au bon niveau d'organisation, faciliter son instruction et tracer les réponses — avec ou sans assistance IA.

## Positionnement de Clara

Clara est le **hub de suivi et de coordination du courrier**. Elle aide à :

1. capter les courriers entrants ;
2. qualifier leur contenu ;
3. les rattacher à une organisation de traitement ;
4. suivre leur workflow d'instruction ;
5. préparer, signer et envoyer des réponses ;
6. rechercher, archiver et purger les courriers selon les règles de conservation.

### Frontière avec les actions métier

Clara ne porte pas toute l'exécution métier des demandes d'action issues d'un courrier.

- Les actions internes Clara restent minimales : demander à un collègue de faire quelque chose, notifier, suivre un état simple.
- Les actions métier complexes sont destinées à être traitées dans des applications partenaires, par exemple Iris ou des connecteurs métier comme Arpège.
- Clara doit pouvoir créer ou référencer ces demandes externes, suivre leur avancement et utiliser leur résolution pour préparer la réponse au courrier.

## Acteurs principaux

| Acteur | Rôle fonctionnel |
|---|---|
| **DSI / administrateur technique** | Configure Clara, les intégrations, l'email, les droits et une partie du paramétrage partagé avec le Socle. |
| **Responsable GRU / responsable courrier / DGS** | Supervise l'organisation du traitement, la qualité de service, les délais, les affectations et la recherche d'historique. |
| **Agent courrier / agent d'accueil / agent instructeur** | Récupère, saisit ou importe les courriers, les qualifie, les affecte, instruit les dossiers et prépare les réponses. |
| **Élu / dirigeant / signataire** | Consulte les demandes sensibles, contrôle la qualité du service, valide ou signe certaines réponses. |
| **Usager / électeur / partenaire externe** | Émet la demande initiale via papier, email, formulaire ou autre canal repris dans Clara. |

## Parcours critique 1 — Importer les courriers

### Objectif

Faire entrer dans Clara tous les courriers reçus par la collectivité, quel que soit leur canal d'origine, sans perdre le contexte ni les pièces jointes.

### Variantes principales

#### 1.1 Import unitaire manuel

Un agent crée un courrier unitaire en scannant un document, en chargeant une pièce jointe ou en copiant-collant un contenu reçu par un autre canal.

Résultat attendu : le courrier existe dans Clara, avec son canal, son sujet, ses participants, ses pièces jointes et son organisation de rattachement si elle est connue.

#### 1.2 Import en masse

Un agent importe plusieurs documents d'un coup, puis les regroupe ou les sépare pour obtenir la bonne granularité : un courrier = un dossier cohérent, pouvant contenir plusieurs fichiers.

Points critiques :

- permettre de regrouper plusieurs documents dans un même courrier ;
- permettre de séparer un lot en plusieurs courriers ;
- éviter qu'un lot documentaire soit confirmé sans vérification ;
- lancer l'OCR/analyse en file d'attente après import.

#### 1.3 Import automatique IMAP

Clara relève automatiquement une ou plusieurs boîtes IMAP.

- Une boîte peut être globale au tenant.
- Une boîte peut être rattachée à une organisation Socle ; dans ce cas, le courrier peut être affecté d'office à cette organisation pour traitement.
- Le courrier créé conserve les informations utiles du mail : expéditeur, destinataires, sujet, corps, pièces jointes et métadonnées techniques.

#### 1.5 Dépôt par le formulaire portail public

Un usager dépose lui-même sa demande sur un formulaire public de la collectivité (lien ou iframe
à jeton). C'est le seul chemin d'entrée où l'usager est **présent** : c'est là que Clara lui pose
les deux questions de consentement RGPD de la gamme — l'utilisation de ses informations pour
traiter sa demande (obligatoire, sans quoi l'envoi est refusé) et leur partage aux services de la
collectivité (facultatif, proposé coché). La phrase affichée est celle qui est consignée, mot
pour mot, avec le nom de la collectivité.

Résultat attendu : un courrier `portal` avec un expéditeur brut (non rapproché) et la trace
immuable de ses consentements. Quand l'agent rattache l'expéditeur à une fiche du référentiel,
la trace est reportée au Socle ; la fiche contact affiche alors trois états possibles par
consentement — accordé, refusé, jamais demandé — et un agent éditeur peut consigner un recueil
reçu autrement (formulaire papier, retrait par courrier).

#### 1.4 Import IMAP depuis un scanner

Un copieur/scanner envoie les documents numérisés vers une boîte IMAP dédiée.

Points critiques :

- le scanner n'est pas l'expéditeur réel du courrier ;
- plusieurs courriers peuvent se trouver dans un même PDF ;
- l'OCR doit aider à qualifier le contenu et, à terme, à proposer un découpage en plusieurs courriers lorsque le lot contient plusieurs demandes ;
- l'agent reste responsable de la validation du découpage et de la qualification.

## Parcours critique 2 — Instruire les courriers

### Objectif

Une fois le courrier rattaché à une organisation, l'agent instructeur doit comprendre la demande, la qualifier, lancer les actions nécessaires et faire progresser le courrier dans son workflow.

### Étapes clés

1. Le courrier est affecté à une organisation Socle.
2. Le workflow applicable à cette organisation détermine les états et transitions possibles.
3. Le courrier entre en instruction.
4. L'analyse IA peut aider l'agent : résumé, extraction du contenu, suggestion de tags, recommandations d'actions ou de démarches.
5. L'agent confirme ou corrige la qualification.
6. Le courrier peut générer une ou plusieurs actions — **seulement une fois orienté et sorti de la boîte aux lettres** : sans organisation gestionnaire, ou à l'état initial de son workflow, ni action ni réponse ne peut être créée (règle tenue par l'écran et par la base).

### Actions issues d'un courrier

Les actions peuvent être :

- des **demandes fondées sur une démarche du référentiel**, déposées dans Iris qui les instruit ;
- des **demandes partenaires**, créées dans une application comme Arpège.

Il n'y a plus d'action « libre » interne à Clara depuis le 2026-09-11 : une action est toujours une demande que quelqu'un instruit (voir `docs/features.md` § 4).

Clara doit conserver la trace de ces actions et de leur résolution, sans remplacer les outils métiers lorsque ceux-ci portent l'exécution complète.

## Parcours critique 3 — Répondre au courrier

### Objectif

Produire une ou plusieurs réponses adaptées au courrier, en tenant compte de son contenu, des actions menées et de l'état d'instruction.

### Réponses typiques

Trois types de réponses interviennent généralement :

1. **Accusé de réception** — confirme la bonne réception et donne éventuellement un délai ou un canal de suivi.
2. **Suivi d'instruction** — informe l'usager qu'une demande est en cours de traitement ou qu'une action externe a été engagée.
3. **Clôture** — apporte la réponse finale, résume les suites données et ferme la demande côté courrier.

### Workflow dédié

Les réponses ont leur propre workflow, paramétrable par organisation. Ce workflow peut intégrer :

- brouillon ;
- relecture ;
- validation — **visa** (une ou plusieurs étapes, voir parcours 4 bis) ;
- signature ;
- envoi ;
- archivage.

L'IA peut aider à rédiger un brouillon : chaque type (accusé de réception, suivi, clôture) a ses consignes, et le modèle écrit `[à compléter]` plutôt que d'inventer un fait, une décision ou un délai. « Améliorer mon message » relit ensuite le texte de l'agent (langue et tournures, jamais le sens) en masquant les données personnelles ; l'amélioration s'annule d'un clic. Dans tous les cas, l'agent reste responsable du contenu final.

## Parcours critique 4 — Signer une réponse

### Objectif

Permettre à un élu, dirigeant ou signataire autorisé d'apposer une signature sur une réponse.

### Règles métier

- Seuls les signataires configurés pour l'organisation peuvent signer.
- Le signataire est généralement un élu, un dirigeant ou une personne explicitement habilitée.
- La signature est une apposition simple d'une image paramétrée pour le signataire.
- La réponse peut être envoyée sous forme d'email ou produite en PDF.
- Pour les PDF, Clara utilise un template aux couleurs du client, avec variables de fusion.

## Parcours critique 4 bis — Viser une réponse

### Objectif

Faire valider une réponse par la hiérarchie (« j'ai vu, je valide ») avant qu'elle n'avance — typiquement chef de service, puis DGS, puis signature de l'élu. Demande prospect du 2026-10-01.

### Règles métier

- Le visa n'appose rien sur le document : c'est une validation tracée, sans image ni modification du texte.
- Une ou plusieurs étapes du workflow réponse sont marquées « étape de visa » ; une même étape ne peut pas être à la fois visa et signature (ni envoi).
- Le viseur est **désigné sur la réponse**, étape par étape. Tout autre viseur de l'organisation gestionnaire peut viser à sa place ; la trace le dit (« à la place de … »).
- Viser exige l'attribut « Viseur » (indépendant du rôle) **et** le rattachement à l'organisation gestionnaire, paramétrés par un administrateur.
- Pendant l'étape, le texte est figé : on vise ce qu'on a lu. Un renvoi en rédaction rouvre le texte ; le visa déjà donné reste dans la trace mais est à refaire au prochain passage.
- Sans visa, la réponse ne peut ni avancer ni être envoyée — même par appel direct à la base. Le renvoi en arrière et l'abandon restent possibles.
- Le visa est visible dans l'onglet Réponse du courrier entrant, sur l'écran du courrier sortant et dans l'historique ; le viseur retrouve ce qui l'attend au tableau de bord (« En attente de votre visa »).

## Parcours critique 5 — Archiver et retrouver les courriers

### Objectif

Garantir que les courriers restent retrouvables pendant leur durée utile, puis soient purgés selon les obligations de conservation et de protection des données.

### Points clés

- Les tags servent au classement et à la recherche.
- La recherche doit permettre de retrouver un courrier par sujet, contenu, participant, état, organisation, dates ou tags selon les capacités disponibles.
- L'archivage doit préserver l'historique utile : événements, réponses, pièces jointes, notes et liens.
- Le RGPD impose une conservation limitée : l'organisme configure une durée de conservation, puis les mécanismes de purge suppriment ou rendent indisponibles les données concernées selon la politique définie.

## Parcours de support — Paramétrer Clara

### Objectif

Permettre à la DSI ou aux administrateurs de rendre Clara opérationnel pour une collectivité.

### Éléments à configurer

- organisation tenant et rattachement Socle ;
- organisations Socle internes, membres et signataires ;
- workflows de courrier et de réponse ;
- boîtes IMAP globales ou rattachées à une organisation ;
- SMTP d'envoi ;
- modèles et templates PDF ;
- tags, classification et démarches ;
- quotas et suivi IA ;
- intégrations partenaires.

## Critères de succès produit

Clara est utile si :

- un courrier ne se perd plus entre services ;
- un responsable peut savoir où en est une demande ;
- un agent comprend rapidement le contenu et le bon circuit d'instruction ;
- un élu ou dirigeant peut suivre les demandes sensibles et signer les réponses nécessaires ;
- les réponses sont tracées, cohérentes et retrouvables ;
- les courriers sont conservés uniquement pendant la durée prévue.
