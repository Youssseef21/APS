# APS — Dashboard Hash Code 2017

Interface web pour **analyser une instance** (`.in`) et **une solution** (`.out`) du problème *Streaming Videos* (Google Hash Code 2017).

L’algorithme n’est **pas** dans ce dépôt. Chacun utilise **son** solveur, produit un `.out`, puis visualise le résultat ici.

Dépôt : [github.com/Youssseef21/APS](https://github.com/Youssseef21/APS)

---

## Idée du score

On gagne du temps si la vidéo est dans un cache **plus proche** que le datacenter.

**Seul le cache le plus rapide compte.** Recopier la même vidéo dans plusieurs caches n’augmente le score que si ces copies servent des endpoints différents (ou plus proches).

Formule officielle :

```text
score = (ms_économisées × 1000) / nombre_total_de_requêtes
```

---

## Prérequis

- Python 3.10 ou plus
- `numpy`

```bash
pip install -r requirements.txt
```

---

## Lancer le dashboard

À la racine du dépôt :

```bash
python dashboard.py
```

Ouvrir [http://127.0.0.1:8765](http://127.0.0.1:8765)

1. Choisir une instance (`.in`) à gauche
2. Choisir une solution (`.out`) dans la liste
3. Lire les stats d’entrée, le score, le remplissage et la duplication

Quelques exemples sont déjà dans `instances/` (`tiny_sanity`, `no_cache`, `isolated_caches`, `me_at_the_zoo`).

---

## Ajouter votre instance et votre solution

Le dashboard ne lance pas votre code. Il lit deux fichiers au **format officiel**.

### 1. Produire un `.out` avec votre algo

Peu importe le langage (Python, C++, Java…). Exemple :

```bash
python mon_solver.py instances/me_at_the_zoo.in instances/me_at_the_zoo.out
```

### 2. Placer les fichiers

Mettez-les **dans le même dossier**, avec le **même nom de base** :

```text
instances/me_at_the_zoo.in
instances/me_at_the_zoo.out
```

Plusieurs solutions sur la même instance :

```text
instances/me_at_the_zoo.in
instances/me_at_the_zoo.out
instances/me_at_the_zoo.alice.out
instances/me_at_the_zoo.bob.out
```

Le dashboard liste automatiquement `nom.out` et `nom.*.out`.

Dossiers scannés : `instances/`, `generated/`, et la racine du projet.

### 3. Relancer (ou rafraîchir) le dashboard

La nouvelle instance apparaît à gauche. Sélectionnez votre `.out` puis **Analyser**.

---

## Format des fichiers

### Instance `.in`

```text
V E R C X
taille_video_0 taille_video_1 ...
latence_datacenter  nb_caches_relies
  cache_id  latence
  ...
video_id  endpoint_id  nb_requetes
...
```

- `V` vidéos, `E` endpoints, `R` lignes de requêtes, `C` caches
- `X` = capacité d’un cache (Mo)

### Solution `.out`

```text
nombre_de_caches_utilises
cache_id  video_id video_id ...
cache_id  video_id ...
```

C’est le format du juge. Une solution invalide (cache trop plein, id hors limites) s’affiche avec un **avertissement**, sans bloquer l’analyse.

---

## Ce que montre l’interface

### Entrée (fichier `.in`)

| Indicateur | Signification |
|------------|----------------|
| Gini / Zipf | Le trafic est-il concentré sur peu de vidéos ? |
| Densité réseau | Un endpoint voit-il beaucoup de caches ? |
| Heatmap | Qui est relié à quel cache, avec quelle latence |

### Solution (fichier `.out`)

| Indicateur | Signification |
|------------|----------------|
| **Score** | Score Hash Code officiel |
| **% du mieux possible** | Score / plafond (chaque endpoint prend son cache le plus proche, **sans** limite de Mo) |
| **Remplissage** | Mo utilisés / `X` par cache |
| **Taux de duplication** | Copies en trop / placements (même vidéo dans plusieurs caches) |
| **Vidéos dupliquées** | Part des vidéos en cache qui ont 2 copies ou plus |
| **Copies inutiles** | Copies jamais utilisées comme cache le plus rapide |
| **Volume DC vs caches** | D’où part réellement le trafic |

La duplication est importante : beaucoup de copies n’améliorent pas le score si un cache plus rapide a déjà la vidéo.

---

## Fichiers du projet

| Fichier | Rôle |
|---------|------|
| `dashboard.py` | Serveur web (port 8765) |
| `web/` | Page HTML / CSS / JS |
| `hc_format.py` | Lecture du format `.in` |
| `instance_stats.py` | Stats d’instance (Zipf, Gini, réseau) |
| `instances/` | Exemples `.in` + `.out` |

Aucun solveur n’est inclus. Pour comparer deux algos : deux `.out` sur le même `.in`, puis le menu **Solution**.

---

## Dépannage

- **Port 8765 déjà pris** : fermer l’autre `python dashboard.py`, ou changer `PORT` dans `dashboard.py`.
- **Aucun `.out`** : le fichier doit s’appeler `meme_nom.out` (ou `meme_nom.quelquechose.out`) à côté du `.in`.
- **Page ancienne** : Ctrl+F5 dans le navigateur.
- **`numpy` manquant** : `pip install -r requirements.txt`.
