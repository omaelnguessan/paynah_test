# Décisions

Ce fichier est ma trace écrite : les choix sur lesquels j'ai hésité, ce que j'ai
écarté, et pourquoi. Je l'ai tenu au fur et à mesure, pas reconstitué à la fin —
d'où quelques entrées qui racontent une erreur avant de donner la solution.

Quand une décision s'écarte de la réponse évidente, je le dis plutôt que de le
noyer.

---

## Les choix, en un tableau

| # | La décision | L'alternative écartée | Pourquoi |
|---|-------------|-----------------------|----------|
| [1](#1-une-saga-orchestrée-et-non-chorégraphiée) | Une saga **orchestrée** : `payments` possède la séquence et émet chaque étape sous forme de commande | La chorégraphie, chaque service réagissant à l'événement du précédent | La compensation exige quelqu'un qui connaisse toute l'histoire. Chorégraphiée, « rendre l'argent » serait une règle éclatée entre trois services et reconstituée depuis le journal d'événements ; orchestrée, c'est un `catch` dans un seul fichier. |
| [2](#2-du-rest-pour-largent-de-lévénementiel-pour-le-ledger) | **REST synchrone** vers `accounts`, **AMQP asynchrone** vers `transactions` | Un seul transport pour les deux, tout en événements ou tout en REST | On ne peut pas répondre « Approved » à l'appelant avant que l'argent ait bougé : le débit doit être synchrone. Le ledger est une conséquence, pas une condition ; faire attendre le paiement dessus lierait sa latence et sa disponibilité à un service dont il n'attend aucune réponse. |
| [3](#3-loutbox-et-non-une-publication-directe) | Un **outbox transactionnel** vidé par un relais | Publier vers RabbitMQ dans le handler | Une publication directe est hors de la transaction : commiter puis planter perd le message, publier puis annuler en invente un. La ligne d'outbox commite *avec* le changement d'état, donc les deux ne peuvent pas se contredire. |
| [4](#4-idempotence-par-clé-appelant-et-non-déduplication-serveur) | Idempotence sur un **`transaction_id` fourni par l'appelant**, réservé par `INSERT` | Une déduplication serveur sur une empreinte de payload ou une fenêtre de temps | Seul l'appelant sait si une seconde requête est un réessai ou un paiement réellement nouveau. Une fenêtre devine, et se trompe dans les deux sens : deux paiements identiques légitimes fusionnent, et un réessai hors fenêtre devient un doublon. |
| [5](#5-un-update-conditionnel-optimiste-et-non-un-verrou-pessimiste) | Un **`UPDATE` conditionnel optimiste**, gardes dans le `WHERE` | `SELECT … FOR UPDATE`, ou une colonne `version` avec boucle de réessai | La vérification et l'écriture sont une seule instruction : aucun solde n'est lu en mémoire puis réécrit. PostgreSQL sérialise la ligne lui-même ; il n'y a pas de fenêtre où perdre une mise à jour, ni de verrou tenu pendant un appel HTTP. |
| [6](#6-cqrs-sur-payments-et-nulle-part-ailleurs) | CQRS sur `payments` seulement | Un bus de commandes dans les trois services | `accounts` et `transactions` ont des charges symétriques ; remplacer un appel de méthode par une commande, un handler et un enregistrement de bus, c'est de l'indirection sans rien derrière. |
| [7](#7-pas-devent-sourcing) | L'état courant dans une ligne ; les événements publiés, pas rejoués | L'event sourcing | La piste d'audit est déjà le ledger append-only. Le sourcing achèterait un voyage dans le temps que personne ne demande, au prix de projections, de snapshots et d'un versionnement de schéma perpétuels. |
| [8](#8-le-modèle-de-lecture-est-une-vue-sql-pas-un-projecteur) | Le modèle de lecture est une **vue SQL** | Un projecteur maintenant une table dénormalisée | Un projecteur ajoute un second chemin d'écriture et une fenêtre pendant laquelle un appelant lit un paiement que le modèle d'écriture a déjà dépassé, précisément sur l'endpoint que les clients interrogent. |
| [9](#9-le-domaine-nétend-pas-aggregateroot) | `pullEvents()` sur un agrégat sans framework | `extends AggregateRoot` de `@nestjs/cqrs` | La même sémantique, sans importer de framework dans la couche 0, qui est la seule propriété rendant l'architecture vérifiable. |
| [10](#10-où-chaque-ligne-doutbox-est-écrite) | Les lignes de ledger écrites par l'étape d'approbation, les lignes de cycle de vie après le commit | Toutes les lignes d'outbox au même endroit | Les lignes de ledger font partie du mouvement d'argent et doivent partager sa transaction ; les notifications, non, et les y attacher serrerait un boulon qui ne tient rien. |
| [11](#11-un-paiement-décliné-répond-201-pas-422) | Un paiement décliné répond **201** avec `status: "Declined"` | Une enveloppe d'erreur en 422 | La ressource existe et porte une référence dont l'appelant a besoin pour rapprocher. Une enveloppe d'erreur porterait un code et perdrait la référence. |
| [12](#12-insufficient_balance-vaut-4001-donc-validation_failed-passe-à-4000) | `INSUFFICIENT_BALANCE` vaut `"4001"`, `VALIDATION_FAILED` vaut `"4000"` | Laisser `"4001"` désigner deux choses | Le contrat fixe `"4001"` sur le refus ; un code ne peut pas nommer deux issues. |
| [13](#13-transaction_id-accepte-le-tiret-bas-et-les-deux-points) | `transaction_id` accepte `_` et `:` | Déformer les clés de la saga pour tenir dans l'ancien jeu de caractères | La clé devient auto-descriptive : un coup d'œil dit de quel paiement et de quelle patte il s'agit. |
| [14](#14-une-réservation-didempotence-est-libérée-quand-le-travail-échoue) | Une tentative échouée **libère** sa réservation | Laisser la clé en `IN_PROGRESS` | Sinon un seul échec transitoire condamne un `transaction_id` pour de bon, c'est-à-dire la seule chose qu'une clé d'idempotence existe pour permettre. |
| [15](#15-un-circuit-breaker-écrit-à-la-main) | Une quarantaine de lignes de circuit breaker | `opossum` | L'écrire a rendu explicite une décision qu'un réglage par défaut aurait cachée : un paiement refusé ne doit pas ouvrir le circuit. |
| [16](#16-larchitecture-est-testée-pas-seulement-lintée) | Un **test** d'architecture, à côté de la règle ESLint | La règle de lint seule | Une règle de lint se désactive en ligne ou se saute en CI ; un test rouge ne s'ignore pas discrètement. |
| [17](#17-le-scénario-de-compensation-bouchonne-une-méthode-pas-la-frontière) | Le e2e de compensation ne bouchonne que le `credit` vers la destination | Simuler tout l'`AccountsPort` | Frontière simulée, le débit n'a jamais lieu et « l'argent est revenu » s'affirme contre un faux. |
| [18](#18-le-plancher-de-couverture-est-appliqué-et-il-exclut-les-barils) | Un plancher de 80 % appliqué, barils exclus | Un chiffre de couverture dans un rapport | Un seuil incapable de faire échouer le build est un chiffre que personne ne lit ; les barils le gonflent sans une seule assertion de plus. |
| [19](#19-les-assertions-sur-le-ledger-interrogent-en-boucle-elles-nattendent-pas) | Une interrogation en boucle avec échéance | Un `sleep` fixe | Cohérent à terme par construction : une attente fixe est soit lente à chaque exécution, soit instable le jour où elle est trop courte. |
| [20](#20-lenvironnement-est-validé-avec-class-validator-et-non-joi) | Environnement validé avec `class-validator` | Joi | La même garantie d'échec immédiat, avec le vocabulaire de validation déjà employé par tous les DTO : une bibliothèque, un jeu de règles, un format d'erreur. |
| [21](#21-la-limitation-de-débit-vit-dans-lapplication-pas-devant-elle) | La limitation de débit est **dans** le service, en mémoire | Une règle sur un reverse proxy, ou un compteur Redis dès maintenant | Une API se défend même quand on l'atteint directement, et le budget voyage avec le code qui sait ce qu'une route coûte. Le stockage partagé est un adaptateur à changer le jour où il y a plusieurs répliques, pas une raison de ne rien poser. |
| [22](#22-le-débit-est-compté-par-identifiant-quand-il-y-en-a-un) | Compteur porté par la clé d'API interne quand elle est présente, par l'IP sinon | Compter tout le monde par IP | Un service amont sort par une seule adresse et émet trois mouvements par paiement : compté comme une IP publique, il s'auto-étrangle avant que quiconque n'attaque. |
| [23](#23-lauthentification-de-lutilisateur-final-est-absente-et-cest-dit) | Pas d'authentification utilisateur, et c'est documenté | Poser un JWT vite fait pour cocher la case | Une couche d'authentification décorative donne l'illusion du contrôle sans modèle de propriété des wallets. Le manque est nommé, avec la forme qu'aurait le correctif. |
| [24](#24-un-débit-dont-on-ignore-lissue-nest-pas-un-refus) | Une réponse perdue laisse le paiement `Processing`, et le réconciliateur interroge `accounts` | Décliner comme pour un refus, ou compenser sans vérifier | Les deux raccourcis se paient en argent : le premier ferme un paiement sur des fonds déjà partis, le second rembourse un débit qui n'a jamais eu lieu. Seul le service qui détient le solde peut trancher. |

---

## 1. Une saga orchestrée, et non chorégraphiée

`payments` possède la séquence. Il émet `DebitSourceWallet`, puis
`CreditDestinationWallet`, et en cas d'échec `CompensatePayment` : trois
commandes, un seul endroit qui décide de la suite.

La chorégraphie était l'alternative : `accounts` émet `wallet.debited`,
`transactions` et `accounts` réagissent, et le paiement émerge de la
conversation. C'est franchement la meilleure forme pour un enchaînement dont les
étapes n'ont pas à être défaites. Celui-ci doit l'être.

La compensation est l'argument. Un crédit qui échoue après un débit réussi
signifie que de l'argent est au mauvais endroit, et le remettre en place suppose
de savoir qu'un débit a eu lieu, pour quel montant, sur quel wallet, sous quelle
clé : toute l'histoire. Orchestrée, cette connaissance tient dans un agrégat et
la réaction est un `catch` dans `payment.saga.ts`. Chorégraphiée, c'est une règle
éclatée entre des services qui n'en détiennent chacun qu'un fragment, à
reconstituer depuis un journal d'événements au moment précis où les choses vont
déjà mal.

Le second argument est le client. `POST /payments` répond une issue réelle,
`Approved`, `Declined` ou `Compensated`, parce qu'un composant a suivi toute la
séquence et sait comment elle s'est terminée. Une version chorégraphiée devrait
répondre `Accepted` et obliger chaque appelant à interroger en boucle.

Ce que coûte l'orchestration, c'est un composant qui connaît les autres. Ce coût
reste contenu ici : la saga connaît des *commandes*, pas des services, et chaque
commande parle à un port. `payments` est un point de couplage par construction,
puisqu'il est la seule chose du système qui ait une raison de savoir qu'un
paiement compte trois étapes.

## 2. Du REST pour l'argent, de l'événementiel pour le ledger

Deux transports, choisis par interaction plutôt que par goût.

Le débit et le crédit sont en **REST synchrone**. On ne peut pas répondre
`Approved` à l'appelant avant que l'argent ait réellement bougé, et la saga ne
peut pas décider de compenser sans savoir si le crédit a réussi. Un événement
transformerait les deux en « probablement, à terme », et la branche de
compensation, celle qui compte, devrait être pilotée par un délai d'attente
plutôt que par une réponse.

Le ledger est en **AMQP asynchrone**. `transactions` est une conséquence du
paiement, jamais une condition : rien de ce qui touche à l'argent ne dépend de la
journalisation immédiate du mouvement. L'appeler en REST placerait un troisième
service dans le budget de latence du paiement, et dans son budget de panne. Une
indisponibilité du ledger se mettrait à décliner des paiements par ailleurs
parfaitement valides. Par le broker, il se contente de rattraper son retard.

La couture est l'outbox, si bien qu'« asynchrone » ne signifie jamais
« éventuellement perdu » : les lignes sont écrites dans la transaction qui a
approuvé le paiement, et le relais réessaie jusqu'à ce que le broker les prenne.

## 3. L'outbox, et non une publication directe

Les handlers n'appellent jamais RabbitMQ. Ils écrivent une ligne dans `outbox`
dans la transaction qui a produit l'événement, et un relais `@Cron` la publie
toutes les deux secondes, en ne marquant `published_at` qu'après acquittement du
broker.

Publier en ligne était l'alternative : une ligne de moins, et durablement fausse.
La publication est hors de la transaction de base, donc il n'existe que deux
ordres possibles et les deux sont cassés. Publier puis commiter, et une
annulation aura annoncé au ledger un paiement qui n'existe pas ; commiter puis
publier, et un crash entre les deux perd le mouvement sans laisser trace qu'il
était dû. Une transaction distribuée entre PostgreSQL et RabbitMQ comblerait
l'écart, à un coût que personne ne devrait payer à cette échelle.

L'outbox fait du message une partie du même commit que l'état qui le justifie, ce
qui transforme un problème de cohérence entre deux systèmes en un problème à un
seul système. Ce qu'il coûte est honnête et modeste : la publication devient au
moins une fois, donc les consommateurs doivent être idempotents. `transactions`
l'est déjà, sur `transaction_id`, qui est la clé même qui le protège d'un appel
HTTP rejoué.

## 4. Idempotence par clé appelant, et non déduplication serveur

`transaction_id` vient de l'appelant et est réservé par un `INSERT` contre une
contrainte unique. L'alternative, une déduplication serveur sur une empreinte du
payload dans une fenêtre de temps, a été écartée parce qu'elle doit deviner
exactement ce que seul l'appelant sait.

Deux paiements identiques de 5 000 XOF entre les mêmes wallets à une minute
d'intervalle peuvent être un réessai comme deux paiements distincts. Une
empreinte ne peut pas trancher, et elle se trompe dans les deux sens : elle
avale silencieusement le second paiement légitime, et elle laisse passer comme un
doublon un réessai arrivé après la fenêtre. Une clé fournie par l'appelant
énonce l'intention au lieu de l'inférer, même clé, même paiement, nouvelle clé,
nouveau paiement, et elle reste juste sans aucune fenêtre.

La réservation est un `INSERT`, jamais un `SELECT` puis un `INSERT` : en
concurrence, les deux requêtes liraient « libre » et poursuivraient toutes les
deux. Laisser la contrainte unique arbitrer garantit qu'une seule gagne, et que
la perdante relit ce que la gagnante a enregistré. La même discipline s'applique
un niveau plus bas, où `accounts` est idempotent sur `(wallet, transaction_id)` :
une étape de saga rejouée ne peut donc pas déplacer l'argent deux fois, même si
la couche paiement était contournée.

## 5. Un `UPDATE` conditionnel optimiste, et non un verrou pessimiste

Un solde bouge par une seule instruction :

```sql
UPDATE wallets
   SET balance = balance + :delta, updated_at = now()
 WHERE id = :id
   AND status = 'Active'
   AND currency = :currency
   AND balance - reserved_amount >= :required   -- sur un débit uniquement
RETURNING balance
```

La garde est dans le `WHERE`, donc la vérification et l'écriture sont la même
opération. Rien n'est lu en mémoire puis réécrit, ce qui veut dire qu'il n'existe
aucune fenêtre entre le moment où l'on juge le solde suffisant et celui où on le
rend tel.

`SELECT … FOR UPDATE` fonctionnerait, et a été écarté pour ce qu'il encourage :
le verrou est pris, puis du code applicatif décide, puis écrit. Cette forme
invite un appel HTTP, une validation ou un `await` entre les deux, en tenant un
verrou de ligne sur un wallet très sollicité pendant toute la durée. Une colonne
`version` avec boucle de réessai a été écartée aussi : sous contention sur un
seul wallet, ce qui est précisément le scénario de concurrence couvert par les
tests, elle convertit chaque perdant en réessai et déclenche une tempête, tout en
ajoutant un conflit applicatif à gérer là où la base en offre déjà un très bon.

L'`UPDATE` conditionnel donne la même garantie sans rien de tout cela. PostgreSQL
sérialise les écrivains sur la ligne, `applied = 0` signifie que la garde a
refusé, et ce refus est une réponse métier plutôt qu'une exception à dérouler. La
suite de bout en bout l'énonce sans détour : dix paiements concurrents contre de
quoi en couvrir six aboutissent exactement six fois, et le solde ne descend
jamais sous zéro.

---

## 6. CQRS sur `payments`, et nulle part ailleurs

`payments` a une charge terriblement asymétrique. Le chemin d'écriture est une
saga : plusieurs étapes, chacune avec sa transaction, une réservation
d'idempotence devant, une branche de compensation derrière, et trois
déclencheurs distincts, une requête HTTP, la saga elle-même et un travail de
réconciliation. Le chemin de lecture, lui, se résume à « donne-moi un paiement
par sa référence ». Modéliser les deux avec un seul repository et un seul service
obligerait chaque lecture à traîner un agrégat en mémoire, avec sa table de
transitions, ses invariants et son tampon d'événements, pour produire un objet
JSON plat.

Les séparer achète trois choses concrètes :

- une commande peut être déclenchée depuis HTTP, depuis la saga ou depuis un cron
  sans duplication, parce que le déclencheur ne fait pas partie du handler ;
- le côté lecture ne touche jamais l'agrégat, donc le modèle d'écriture peut être
  remanié sans casser une requête ;
- chaque handler est une intention et une transaction, ce qui rend « ce qui
  commite ensemble » lisible depuis la liste des fichiers.

`accounts` et `transactions` n'en tirent rien. `accounts` est un CRUD
transactionnel : un `UPDATE` conditionnel, une insertion au ledger, terminé.
`transactions` est un ajout et une lecture paginée. Ajouter un bus de commandes à
l'un ou à l'autre reviendrait à remplacer un appel de méthode par une commande,
un handler, un enregistrement de bus et une ligne de câblage de module. J'ai
fait le test mentalement sur `transactions` : je n'ai rien trouvé que ça
améliore. CQRS répond à une asymétrie de charge, et il n'y en a pas ici.

## 7. Pas d'event sourcing

L'état courant vit dans une ligne de `payments`, mise à jour sur place. Les
événements que l'agrégat émet sont publiés, pas rejoués : ce sont des
notifications, pas la source de vérité.

L'event sourcing serait de la sur-ingénierie à cette échelle. Il achète une piste
d'audit complète et un voyage dans le temps ; la piste d'audit est ici déjà
assurée par le ledger append-only de `transactions` et par l'outbox, et rien ne
demande de reconstruire un paiement tel qu'il était mardi dernier. Ce qu'il
coûterait est bien réel : des projections à reconstruire, des snapshots à régler,
un versionnement de schéma pour chaque événement jamais écrit, et une histoire
nettement plus difficile pour le travail de réconciliation. La machine à états
donne la sûreté qu'on va d'ordinaire chercher dans l'event sourcing, à savoir
qu'une transition illégale est impossible, sans rien de tout cela.

## 8. Le modèle de lecture est une vue SQL, pas un projecteur

`payment_read_model` est une vue au-dessus de `payments`, mappée sur sa propre
entité de lecture derrière son propre port.

Un projecteur maintenant une table dénormalisée ajouterait un second chemin
d'écriture à garder synchronisé, et une fenêtre pendant laquelle un appelant lit
un paiement que le modèle d'écriture a déjà dépassé. Cette fenêtre est exactement
ce dont on ne veut pas sur l'endpoint qu'un client interroge après un
`POST /payments`. La vue n'a ni l'un ni l'autre problème.

Ce qui compte pour CQRS est préservé : les requêtes ont leur contrat, leur port
et leur repository, et **elles n'hydratent jamais l'agrégat `Payment`**.

Une correction tardive sur ce point. `PaymentView` portait au départ les noms de
l'API — `transaction_id`, `source_wallet_reference` — donc la forme d'une
réponse JSON était décrite dans la couche 0, ce qui inverse la règle de
dépendance sans en avoir l'air. La projection parle maintenant le vocabulaire du
domaine et c'est `PaymentMapper` qui traduit, avec un test qui échoue si une
graphie du domaine ressort sur le fil. La leçon vaut plus que le correctif : une
fuite d'architecture ne ressemble pas à un import interdit, elle ressemble à un
nom de champ. Quand le
côté lecture gagnera une jointure, le propriétaire du wallet par exemple, elle
atterrira dans la définition de la vue sans qu'un seul handler de requête change.
Si le volume de lecture justifie un jour une table matérialisée, le port reste et
seul l'adaptateur derrière lui bouge.

## 9. Le domaine n'étend pas `AggregateRoot`

La voie idiomatique sous NestJS est `publisher.mergeObjectContext(...)` suivi de
`payment.commit()`, et les deux exigent que `Payment` étende `AggregateRoot` de
`@nestjs/cqrs`. Cela contredit la seule règle sur laquelle repose tout le
découpage : `src/domain` n'importe aucun framework.

`pullEvents()` l'a emporté. L'agrégat accumule les événements et les remet ; le
handler de commande les publie sur l'`EventBus` **après** que sa transaction a
commité. La sémantique est identique à celle de `commit()` ; la différence est
que la couche 0 n'importe rien. Faire étendre une classe de framework au domaine
pour obtenir un tampon d'événements qu'il possède déjà échangerait la seule
propriété qui rend l'architecture vérifiable contre un nom de méthode.

## 10. Où chaque ligne d'outbox est écrite

Deux sortes de messages atteignent l'outbox, et elles sont écrites à des endroits
différents à dessein.

- **`payment.transaction.recorded` ×2**, le débit et le crédit, est écrit par
  l'étape de saga qui approuve le paiement, **dans la même transaction** que le
  changement de statut. C'est ce qui empêche le ledger d'entendre parler d'un
  paiement que la base a annulé.
- **`payment.approved` / `payment.declined` / `payment.compensated`** sont écrits
  par les handlers d'événements de domaine, après le commit. Ce sont des
  notifications de cycle de vie destinées à qui écoute ; elles ne font pas partie
  du mouvement d'argent, donc les lier à la transaction reviendrait à serrer un
  boulon qui ne tient rien.

Les deux obéissent à la règle qui compte : aucun handler n'appelle jamais
RabbitMQ directement.

## 11. Un paiement décliné répond 201, pas 422

`POST /payments` renvoie **201** avec `status: "Declined"` quand la source ne
peut pas couvrir le paiement. La ressource paiement existe réellement, elle a une
référence, une ligne et un cycle de vie, et l'appelant a besoin de cette
référence pour rapprocher plus tard. Une enveloppe d'erreur porterait un code à la
place, et la référence serait perdue.

Le refus n'est pas dissimulé : `status` et `failure_reason` le portent, dans la
même forme que toutes les autres issues, si bien qu'un client n'analyse qu'un
seul type de réponse. Cela diffère d'`accounts`, où `POST /accounts/:ref/debit`
renvoie un 422 pour la même condition : là, aucune ressource n'est créée et il
n'y a rien à rendre.

## 12. `INSUFFICIENT_BALANCE` vaut `"4001"`, donc `VALIDATION_FAILED` passe à `"4000"`

Le contrat de `payments` fixe `code: "4001"` sur `INSUFFICIENT_BALANCE` derrière
un 422. Un exemple antérieur utilisait `"4001"` pour `VALIDATION_FAILED`. Plutôt
que de laisser un code désigner deux choses, le catalogue a été renuméroté autour
de la valeur fixée. Les refus métier, solde insuffisant, wallet gelé, devise
différente, sont des 422 : la requête était bien formée et le domaine l'a
refusée. Le 409 reste réservé à un appelant qui se contredit, ce qu'est un
conflit d'idempotence.

`TRANSACTION_NOT_FOUND` (`"4008"`) a été ajouté à `ResponseMessage` : ni
`GET /transactions/:reference` ni `GET /payments/:reference` n'avaient de 404
honnête dans l'énumération telle qu'elle était, et en étiqueter un en
`WALLET_NOT_FOUND` aurait été pire que d'étendre le contrat d'un membre.

## 13. `transaction_id` accepte le tiret bas et les deux-points

La saga dérive ses clés d'idempotence de la référence du paiement : `pay_01hq…`
pour le débit, `pay_01hq…:credit`, `pay_01hq…:refund`. Le jeu de caractères
d'origine (`[A-Za-z0-9-]`) n'autorisait ni le tiret bas ni les deux-points, si
bien qu'`accounts` refusait chaque mouvement émis par la saga avec un banal
`VALIDATION_FAILED`. J'ai cherché du côté de la saga pendant un bon moment avant
de regarder le décorateur.

Élargir le jeu de caractères a été préféré à la déformation des clés, parce que
la clé devient alors auto-descriptive : un coup d'œil à un mouvement dans
`accounts` dit à quel paiement et à quelle patte il appartient. Le lien est
*aussi* porté structurellement par `payment_reference`, puisqu'une description ne
peut pas contenir de tiret bas et qu'une référence en contient toujours un. La
référence a sa place dans un champ, pas dans du texte libre.

## 14. Une réservation d'idempotence est libérée quand le travail échoue

Le flux évident laisse une clé en `IN_PROGRESS` après un échec, ce qui répond 409
à toute tentative ultérieure. Pris au pied de la lettre, un échec transitoire
condamnerait un `transaction_id` définitivement, et l'appelant ne pourrait plus
jamais réessayer avec la même clé, c'est-à-dire la seule chose qu'une clé
d'idempotence existe pour permettre.

La réservation est donc libérée quand le cas d'usage lève une erreur, n'ayant
rien commité. La concurrence reste traitée : pendant que la première tentative
tourne, la ligne existe, et un doublon en course reçoit son 409. Ce qui change,
c'est seulement qu'une tentative *échouée* n'empoisonne pas la clé. Un crash en
pleine saga est un autre sujet, traité par le réconciliateur et non par la clé.

## 15. Un circuit breaker écrit à la main

`opossum` était l'alternative. Le comportement qui vaut la peine tient en une
quarantaine de lignes, compter les échecs consécutifs, ouvrir, refroidir, laisser
passer une sonde, et l'écrire a rendu explicite une décision qu'un réglage par
défaut aurait cachée : **un paiement décliné ne doit pas ouvrir le circuit**. Un
refus signifie qu'`accounts` est debout et répond ; le compter comme un échec
ferait sauter le breaker pendant une série de clients légitimement démunis, et
mettrait le service à terre pour tous les autres.

## 16. L'architecture est testée, pas seulement lintée

`.eslintrc.json` porte les règles `no-restricted-imports`, et
`src/architecture.spec.ts` analyse chaque instruction d'import réelle et fait
échouer le build sur une violation. Une règle de lint se désactive en ligne ou se
saute en CI ; un test rouge ne s'ignore pas discrètement. Le test vérifie aussi
le cas négatif, à savoir qu'il échoue lorsqu'une violation est introduite, parce
qu'un garde-fou incapable d'échouer ne prouve rien. Ajouter `@nestjs/common` et
un import d'`infrastructure/` dans `domain/model/money.ts` le fait passer au
rouge sur les deux tableaux.

## 17. Le scénario de compensation bouchonne une méthode, pas la frontière

Le scénario à couvrir est un `accounts.credit` qui expire après un débit réussi.
La tentation est de simuler tout l'`AccountsPort`, mais alors le débit censé
avoir eu lieu n'a pas eu lieu, le wallet source n'est jamais réellement à
découvert, et « l'argent est revenu » s'affirme contre un faux.

Seul le crédit vers la destination est donc bouchonné, sur une seconde instance
d'application où `ACCOUNTS_PORT` est remplacé. Le débit part vers le vrai
service, et le remboursement aussi, lui qui est également un `credit` et se
distingue par sa clé d'idempotence `:refund`. Ce que le test affirme alors est un
vrai mouvement d'argent : la source est débitée par le vrai `UPDATE` conditionnel
puis rétablie par un vrai remboursement, et la ligne `REFUND` arrive dans
`transactions` par le vrai outbox et le vrai broker.

Le même raisonnement gouverne le scénario de concurrence. Dix paiements se
disputent de quoi en couvrir six, à travers la vraie frontière HTTP et la vraie
base. Six sont approuvés, quatre déclinés, le wallet atterrit sur zéro et n'en
descend jamais, ce qui est une affirmation sur l'`UPDATE` conditionnel, et
qu'aucun test le simulant ne pourrait formuler.

## 18. Le plancher de couverture est appliqué, et il exclut les barils

`services/payments/jest.config.js` porte un `coverageThreshold` de 80 % sur
`src/domain/` et `src/application/`, de sorte que la cible est un échec de build
plutôt qu'une ligne dans un rapport que personne ne lit.

Les barils `index.ts` et les doublures de test sont exclus de la mesure. Un
fichier de réexport est couvert par le simple fait d'importer quoi que ce soit à
travers lui, et une doublure l'est par le fait d'être utilisée ; compter l'un ou
l'autre relèverait le chiffre sans une seule assertion de plus derrière. Ce qui
est mesuré, c'est du code qui peut être faux.

## 19. Les assertions sur le ledger interrogent en boucle, elles n'attendent pas

Les mouvements atteignent `transactions` par l'outbox et RabbitMQ : le ledger est
donc cohérent à terme par construction. Un `sleep` fixe devrait être assez long
pour la machine de CI la plus lente, faisant payer le pire cas à chaque
exécution, et resterait instable le jour où il ne serait pas assez long.

La suite interroge en boucle jusqu'à ce que l'attente soit satisfaite ou qu'une
échéance passe. Le seul endroit où elle patiente trois secondes fixes est
l'assertion inverse, celle qui vérifie qu'*aucune* ligne n'a été écrite pour un
paiement décliné : il n'y a rien à attendre en boucle, et la question est
seulement de savoir si quelque chose apparaît quand on lui en laisse le temps.

## 20. L'environnement est validé avec `class-validator`, et non Joi

Joi est le choix habituel pour cela. Chaque service valide plutôt son
environnement avec les mêmes décorateurs `class-validator` que ceux qu'emploient
déjà tous les DTO, via une classe `EnvConfig` typée exécutée au démarrage par le
hook `validate` de `ConfigModule`.

La garantie est celle que Joi donnerait : un `DB_PASSWORD` manquant, un port hors
de `1–65535` ou un `INTERNAL_API_SECRET` de moins de 32 caractères arrête le
processus avant qu'il n'écoute, en listant d'un coup toutes les variables
fautives, plutôt qu'un conteneur qui démarre et échoue à la première requête.

Ce qui change, c'est que le service embarque une bibliothèque de validation au
lieu de deux. Les règles se lisent comme celles des DTO, le format d'erreur est
le même, et il n'y a pas un second langage de schéma à tenir à jour avec
`.env.example`. Ajouter Joi à côté aurait acheté un nom familier au prix d'un
vocabulaire parallèle pour la seule chose qui ne doit jamais se contredire.

## 21. La limitation de débit vit dans l'application, pas devant elle

Le compteur est un guard NestJS, en mémoire, dans chacun des trois services.
L'alternative habituelle est une règle sur le reverse proxy, et elle a de vrais
avantages : elle coûte zéro CPU applicatif et elle protège même quand le
processus est saturé.

Elle a surtout un défaut ici. Les trois services se parlent à l'intérieur du
réseau, sans passer par le proxy, et rien ne garantit qu'un déploiement futur
place le même proxy devant chacun. Une API qui ne se défend que derrière un
équipement se retrouve nue le jour où on l'atteint directement, ce qui est
exactement ce que fait la suite de bout en bout. Placer la règle dans le code
la rend aussi versionnée, testée et lisible au même endroit que la route
qu'elle protège : `POST /payments` porte son budget dans sa signature.

Le stockage est en mémoire, donc par instance : deux répliques doublent le
plafond effectif. C'est assumé, et écrit dans le README plutôt que découvert
plus tard. `@nestjs/throttler` accepte un stockage Redis derrière la même
interface, donc le jour venu c'est un adaptateur à changer, pas un appel. Poser
un Redis maintenant aurait ajouté un composant à exploiter pour un bénéfice qui
n'existe qu'à partir de la deuxième instance.

Un détail que je n'avais pas vu venir : un guard global voit **tous** les
contextes d'exécution, y compris les livraisons RabbitMQ que `transactions`
consomme dans la même application. Ma première version appelait
`switchToHttp()` sans se poser de question et faisait tomber le consommateur à
chaque message. Ce sont les tests e2e qui l'ont trouvé — cinq scénarios rouges
et un service mort dans les logs. Le guard laisse maintenant passer tout ce qui
n'est pas HTTP, et un test le verrouille.

## 22. Le débit est compté par identifiant quand il y en a un

Le compteur porte sur l'adresse IP de l'appelant, sauf quand celui-ci présente
une `x-api-key` : le seau est alors dérivé de cette clé.

Compter tout le monde par IP paraît plus simple et se comporte mal. `payments`
sort par une seule adresse et émet deux à trois mouvements par paiement : avec
un plafond public, la plateforme s'étranglerait elle-même bien avant qu'un
attaquant ne s'en approche. À l'inverse, plusieurs clients derrière un même NAT
partageraient un seau qu'aucun d'eux ne remplit seul.

Ce n'est pas la clé qui sert de compteur mais une empreinte courte et non
réversible : un identifiant de seau ne doit jamais devenir un secret qui se
promène dans un log ou dans un chemin d'erreur. Et la clé reste vérifiée par le
guard : le compteur choisit un seau, il n'authentifie personne.

## 23. L'authentification de l'utilisateur final est absente, et c'est dit

`POST /payments` n'exige aucun jeton. Qui connaît une référence de wallet peut
demander un paiement depuis ce wallet. C'est le manque le plus important de la
plateforme, et il est documenté plutôt que masqué.

La tentation était de poser un JWT rapidement pour cocher la case. Cela aurait
produit un contrôle décoratif : sans modèle de propriété — un utilisateur, ses
wallets, et la vérification que l'appelant possède bien le wallet source — un
jeton valide n'empêche personne de débiter le compte du voisin. La question
n'est pas « y a-t-il un jeton », elle est « ce porteur a-t-il le droit de
déplacer cet argent-là ».

La forme du correctif est connue et tient en trois pièces : une identité portée
par un jeton signé et court, un lien `wallet → propriétaire` déjà présent en
base, et une vérification dans la couche présentation de `payments` avant que la
commande ne soit construite. Le guard interne actuel reste à sa place : il
protège la frontière entre services, qui est un problème différent de celui de
savoir qui est l'humain à l'autre bout.

## 24. Un débit dont on ignore l'issue n'est pas un refus

J'ai trouvé ces deux défauts en écrivant la documentation des cas de panne, pas
en écrivant le code : c'est en essayant de remplir le tableau « qui se passe
quoi quand `accounts` tombe » que deux cases se sont révélées fausses.

Le premier jet traitait de la même façon les deux erreurs que `accounts` peut
produire : le paiement était décliné, que le service ait refusé le mouvement ou
qu'il n'ait rien répondu du tout. C'était faux, et faux d'une manière qui se
compte en argent.

Un refus nommé — solde insuffisant, wallet gelé, devise différente — est une
réponse : le service est debout, il a évalué la demande, rien n'a bougé.
Décliner est correct, et l'état est terminal.

Une absence de réponse n'est pas une réponse. `accounts` a pu appliquer le débit
et perdre le chemin du retour. Décliner revient alors à clore le paiement sur
des fonds qui ont réellement quitté le wallet, sans que personne ne repasse
jamais dessus, puisque `Declined` est terminal. Le paiement reste donc
`Processing`, ce qui est exactement ce que le réconciliateur cherche.

Restait le symétrique, plus vicieux. Un paiement `Processing` sans référence de
débit recouvre deux mondes opposés : le processus est mort avant d'envoyer le
débit, ou après que celui-ci a été appliqué mais avant d'en enregistrer la
référence. Rembourser dans le premier cas crée de l'argent. Aucun état local ne
permet de les distinguer, parce que l'information n'est pas là : elle est chez
`accounts`.

D'où la lecture `GET /accounts/:reference/movements/:transaction_id`, sous la
clé d'idempotence du débit. Elle rend la question posable sans effet de bord, et
donne trois réponses au lieu de deux : le mouvement existe, il n'existe pas, ou
on ne sait toujours pas. Le troisième cas ne décide rien et laisse le paiement
tel quel — ce qui est la bonne réponse quand on ignore, et ce qu'aucun booléen
n'aurait su exprimer.

J'ai d'abord voulu éviter le nouvel endpoint en rejouant simplement le débit
sous la même clé : c'est idempotent, donc ça renvoie le mouvement d'origine s'il
existe. Sauf que si le débit n'a jamais eu lieu, ce « rejeu » l'applique pour de
bon, et il faut le rembourser dans la foulée. Le solde final serait juste, avec
deux lignes de ledger inventées à chaque réparation. J'ai préféré vingt lignes
de plus dans `accounts`.


## 25. Un crédit inconnu n’autorise pas un remboursement

La compensation automatique sur timeout de crédit pouvait rendre l’argent à
la source alors que la destination l’avait reçu. Désormais, un refus métier
confirmé est persisté en `CompensationPending` avant le remboursement. Un
timeout, une réponse ambiguë ou une panne de commit laisse `Processing`.
Le réconciliateur recherche `:credit` et finalise l’approbation si le mouvement
existe. Une absence, même répétée, n’autorise pas un remboursement : la requête
peut encore être en cours. Ces cas restent en attente d’une résolution opérateur.
Un refus reçu après une tentative HTTP incertaine reste lui-même incertain.

Ce choix remplace la règle précédente « tout échec du crédit se compense ».
Il ne résout pas la coordination de plusieurs orchestrateurs concurrents.


## 26. L’idempotence commite avec la création du paiement

La réservation, le paiement Pending et la réponse contenant sa référence sont
une seule transaction locale. La saga commence après ce commit. Un crash avant
commit annule le tout ; un crash après permet de relire la même référence sans
recréer de paiement ni rejouer ses mouvements. COMPLETED décrit ici la création
de la ressource, pas la fin du transfert. Les requêtes concurrentes attendent la
transaction qui possède la clé. La migration de réparation des anciennes clés
doit être exécutée avec les anciennes instances payments arrêtées.


## 27. Un seul traitement actif par paiement

Un verrou de session PostgreSQL couvre la saga et les commandes de reprise,
y compris les appels HTTP. Les commandes imbriquées rejoignent ce verrou.
Un second worker reçoit un conflit et réessaiera plus tard. Les transactions
locales réutilisent la connexion du verrou, sans garder une transaction ouverte
pendant le réseau ni épuiser le pool avec une seconde connexion par saga.
Une colonne version interdit aussi les sauvegardes d’agrégats périmés.
Le débit vérifie l’état Pending avant tout effet externe.

Une session PostgreSQL perdue libère son verrou ; cela n’annule pas un appel
HTTP déjà parti. Le traitement des résultats inconnus et les clés idempotentes
restent donc nécessaires, même avec cette exclusion mutuelle.
