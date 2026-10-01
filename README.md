# APS — Dashboard Hash Code 2017

Analyse d’une **instance** (`.in`) et d’une **solution** (`.out`).  
Pas d’algorithme ici : chacun lance le sien, puis dépose son `.out`.

## Lancer

```bash
pip install -r requirements.txt
python dashboard.py
```

Ouvrir [http://127.0.0.1:8765](http://127.0.0.1:8765)

Choisir un `.in` à gauche, un `.out` dans la liste.

## Ajouter vos fichiers

Mettez-les dans `instances/` avec le **même nom** :

```text
instances/me_at_the_zoo.in
instances/me_at_the_zoo.out
```

Plusieurs solutions : `me_at_the_zoo.alice.out`, `me_at_the_zoo.bob.out`, etc.

## Score

On gagne du temps si la vidéo est dans un cache plus proche que le datacenter.  
**Seul le cache le plus rapide compte.**

```text
score = (ms économisées × 1000) / nombre de requêtes
```
