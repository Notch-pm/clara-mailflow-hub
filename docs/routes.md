# Routes

Définies dans `src/App.tsx`. Trois zones : publique, super-admin, utilisateur authentifié.

## Public (`PublicRoute`)
| Path | Page | Note |
|---|---|---|
| `/connexion` | `Login` | Redirige vers `/` ou `/superadmin` si déjà connecté. |
| `/reset-password` | `ResetPassword` | Accessible sans session. |
| `/activer-compte` | `ActivateAccount` | Lien d'invitation. |

## Super-admin (`SuperAdminRoute` — requiert `is_superadmin = true`)
| Path | Page |
|---|---|
| `/superadmin` | `SuperAdminDashboard` |
| `/superadmin/organisations` | `OrganizationsAdmin` |
| `/superadmin/organisations/:orgId` | `OrgSettings` |

## Utilisateur (`ProtectedRoutes` + `AppLayout` — requiert session + membership)
| Path | Page | Description |
|---|---|---|
| `/` | `Dashboard` | Vue d'ensemble. |
| `/boite-aux-lettres` | `BoiteAuxLettres` | Nouveaux courriers reçus. |
| `/courriers-en-instruction` | `CourriersEnInstruction` | États `in_progress`. |
| `/courriers-traites` | `CourriersTraites` | États `processed`. |
| `/courriers-archives` | `CourriersArchives` | États `archived`. |
| `/courriers-sortants` | `CourriersSortants` | Réponses + courriers outbound. |
| `/courrier/:id` | `CourierDetail` | Vue détail (onglets : contenu/intents, historique, actions liées, notes). |
| `/workflows/:id` | `WorkflowDetail` | Éditeur React Flow (lazy-loaded). |
| `/parametres` | `SettingsPage` | Hub vers sous-paramètres. |
| `/mon-profil` | `MonProfil` | Profil utilisateur. |
| `/liens` | `Liens` | Liens utiles configurables. |
| `/usagers` | `Usagers` | Annuaire des usagers. |
| `/usagers/:id` | `Usagers` | Fiche usager. |

## Sous-pages paramètres

Atteintes depuis `SettingsPage` ou `OrgSettings` (super-admin) :
- `ClassificationSettings` — workflows / catégories.
- `ServicesSettings` — services internes + IMAP par service.
- `ModeleSettings` — modèles de réponse.
- `SignaturesSettings` — signataires.
- `ProceduresSettings` — démarches (avec sync Arpège).
- `UsersPage` — utilisateurs de l'org (admin only).
- `GeneralSettings`, `SmtpSettings`, `ImapSettings`, `OrgIntegrations`.

## Fallbacks
- Aucune session → redirect `/connexion`.
- Session OK mais pas de profile → `NoProfileFallback` (signOut auto).
- Profile OK mais pas de membership → `NoOrganizationFallback`.
- Superadmin → forcé vers `/superadmin`.
