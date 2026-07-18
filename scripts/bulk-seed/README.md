# Jeu de données de charge

Remplit le tenant **ACCM** de courriers pour observer le comportement de
l'application sur une base volumineuse. Rien à voir avec `scripts/seed-test-env.ts`,
qui gère les tenants `[TEST]` des suites automatisées : ces scripts-ci visent
l'exploration manuelle sur des données proches du réel.

## Contenu généré

| Script | Projet | Contenu |
|---|---|---|
| `01-contacts-socle.sql` | Socle `qhrokbkyxgcvkbpmbmna` | 300 contacts (240 personnes, 30 entreprises, 20 associations, 10 administrations) sous la racine ACCM |
| `02-couriers-clara.sql` | Clara `aullweizxcjbvtdspjli` | 5 000 courriers + 10 000 participants + ~10 000 événements |
| `99-purge.sql` | les deux | Suppression du lot, en deux temps |

Chaque objet de courrier est **préfixé par l'organisation destinataire** :

```
[Services techniques] Demande de raccordement au réseau d'eau potable — dossier 2026-00042
[Direction du Cabinet] Recours gracieux contre un refus de permis de construire — dossier 2025-01337
```

Les courriers se répartissent sur les 7 organisations avec des poids inégaux
(Direction du Cabinet et Services techniques concentrent ~55 % du flux, comme en
production) et couvrent les 7 états du workflow `test`. Les dates de réception
s'étalent sur 24 mois, avec une densité plus forte sur les 6 derniers.

## Marqueurs de purge

Le lot est identifiable sans ambiguïté, ce qui permet de le retirer sans toucher
aux données réelles (61 courriers ACCM, 5 contacts d'origine) :

- `couriers.metadata->>'seed_bulk' = 'true'`
- `courier_participants.metadata->>'seed_bulk' = 'true'`
- `contacts.internal_notes = '[SEED-BULK]'`

## Contacts : identifiants déterministes

Les contacts vivent dans le projet **Socle**, les participants dans **Clara** :
deux bases distinctes, donc aucune clé étrangère entre `courier_participants.socle_contact_id`
et `contacts.id`. Plutôt que de transporter 300 lignes d'un projet à l'autre, les
deux scripts **recalculent** les mêmes valeurs :

```sql
md5('clara-bulk-contact-' || g)::uuid          -- identifiant
md5('prenom' || g), md5('nom' || g)            -- index dans les tableaux de noms
```

`md5` et non `hashtext` ni un multiplicateur : `hashtext` n'est pas garanti stable
d'une instance Postgres à l'autre, et `(g*7)%20` / `(g*13)%40` se resynchronisent
tous les 40 tours (40 noms distincts sur 240 fiches ; un LCG plafonne à 113).
Avec `md5` on obtient 204 combinaisons distinctes, quelques homonymes — utiles
pour la détection de doublons — et un résultat identique des deux côtés.

## Ajuster le volume

Modifier `generate_series(1, 5000)` dans `02-couriers-clara.sql`. Le script
s'exécute en une seule instruction ; il est rejouable, mais chaque exécution
**ajoute** un lot — purger d'abord pour repartir de zéro.
