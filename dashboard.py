"""
Dashboard web : analyse d'une instance (.in) et d'une solution (.out).

    python dashboard.py
    -> http://127.0.0.1:8765
"""

from __future__ import annotations

import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

import numpy as np

from hc_format import read_input
from instance_stats import analyze_instance, drop_arrays, summary_row

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CACHE = ROOT / "web_cache"
PORT = 8765
CACHE_VERSION = 6

_stats_mem = {}
_analyse_mem = {}
_lock = threading.Lock()


def _datasets() -> list[dict]:
    rows = []
    seen = set()
    folders = [(ROOT, "racine")]
    for name in ("instances", "generated"):
        folder = ROOT / name
        if folder.is_dir():
            folders.append((folder, name))
    for folder, family in folders:
        for path in sorted(folder.glob("*.in")):
            if path.stem in ("large_fastfill", "kittens"):
                continue
            key = path.resolve()
            if key in seen:
                continue
            seen.add(key)
            rows.append(_peek(path, family))
    return rows


def _peek(path: Path, family: str) -> dict:
    with path.open("r", encoding="utf-8") as file:
        V, E, R, C, X = map(int, file.readline().split())
    return {
        "id": _did(path),
        "fichier": path.name,
        "chemin": str(path.relative_to(ROOT)).replace("\\", "/"),
        "famille": family,
        "V": V,
        "E": E,
        "R": R,
        "C": C,
        "X": X,
        "lourd": R >= 50_000 or V >= 5_000,
        "solutions": _outs_for(path),
    }


def _outs_for(in_path: Path) -> list[dict]:
    folder = in_path.parent
    cands = [folder / f"{in_path.stem}.out"]
    cands.extend(sorted(folder.glob(f"{in_path.stem}.*.out")))
    rows = []
    seen = set()
    for path in cands:
        if not path.is_file():
            continue
        key = path.resolve()
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "id": _did(path),
            "fichier": path.name,
            "chemin": str(path.relative_to(ROOT)).replace("\\", "/"),
        })
    return rows


def _did(path: Path) -> str:
    rel = path.resolve().relative_to(ROOT.resolve()).as_posix()
    return rel.replace("/", "__")


def _path_from_id(file_id: str) -> Path | None:
    file_id = unquote(file_id)
    root = ROOT.resolve()
    rel = file_id.replace("__", "/")
    path = (ROOT / rel).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    return path if path.is_file() else None


def _jsonable_stats(stats: dict) -> dict:
    arrays = stats.get("_arrays", {})
    sizes = arrays.get("sizes")
    volume = arrays.get("video_volume")
    payload = drop_arrays(stats)
    payload["resume"] = summary_row(stats)
    payload["graphiques"] = {
        "tailles": _sample_list(sizes, 8000),
        "zipf": _zipf(volume),
        "lorenz": _lorenz(volume),
        "degre_endpoint": _tolist(arrays.get("ep_degree")),
        "degre_cache": _tolist(arrays.get("cache_degree")),
        "volume_endpoint": _tolist(arrays.get("ep_volume")),
        "latence_dc": _tolist(arrays.get("dc_lats")),
        "latence_cache": _sample_list(arrays.get("cache_lats"), 8000),
        "gains": _sample_list(arrays.get("gains"), 8000),
        "scatter": _scatter(sizes, volume),
    }
    return payload


def _tolist(arr):
    if arr is None:
        return []
    return arr.tolist()


def _sample_list(arr, cap: int):
    if arr is None:
        return []
    if arr.size <= cap:
        return arr.tolist()
    step = max(1, arr.size // cap)
    return arr[::step].tolist()


def _lorenz(volume) -> list:
    if volume is None or volume.size == 0:
        return []
    ranked = np.sort(volume)[::-1]
    total = float(ranked.sum())
    if total <= 0:
        return []
    cum = np.cumsum(ranked) / total
    n = min(100, cum.size)
    idx = np.linspace(0, cum.size - 1, n).astype(int)
    return [{"x": float(i / max(cum.size - 1, 1)), "y": float(cum[i])} for i in idx]


def _scatter(sizes, volume) -> list:
    if sizes is None or volume is None:
        return []
    points = []
    for i, (sz, vol) in enumerate(zip(sizes.tolist(), volume.tolist())):
        if vol > 0:
            points.append((int(i), int(sz), int(vol)))
    points.sort(key=lambda p: p[2], reverse=True)
    points = points[: min(250, len(points))]
    return [{"v": a, "size": b, "vol": c} for a, b, c in points]


def calculate_score(endpoints, requests, caches):
    total_saved = 0
    total_requests = 0
    for video_id, endpoint_id, count in requests:
        endpoint = endpoints[endpoint_id]
        datacenter = endpoint["datacenter_latency"]
        best = datacenter
        for cache_id, latency in endpoint["caches"].items():
            if video_id in caches[cache_id] and latency < best:
                best = latency
        total_saved += (datacenter - best) * count
        total_requests += count
    if total_requests == 0:
        return 0
    return (total_saved * 1000) // total_requests


def _solution_details(C, X, V, E, sizes, endpoints, requests, caches):
    fill = [sum(sizes[v] for v in videos) for videos in caches]
    occupation = [round(100.0 * f / X, 1) if X else 0.0 for f in fill]
    n_videos = [len(videos) for videos in caches]
    presence = [0] * V
    for videos in caches:
        for v in videos:
            presence[v] += 1
    copies = sum(presence)
    unique = sum(1 for n in presence if n > 0)
    extra = copies - unique
    duplicated_videos = sum(1 for n in presence if n >= 2)
    max_copies = max(presence) if presence else 0
    hist = [0] * (max_copies + 1)
    for n in presence:
        if n:
            hist[n] += 1
    mo_stored = sum(fill)
    mo_unique = sum(sizes[v] for v, n in enumerate(presence) if n > 0)
    mo_extra = mo_stored - mo_unique

    time_saved = [0] * C
    data_dc = [0] * E
    data_from_cache = [0] * C
    stack_ok = E * (C + 1) <= 4000
    data_cache_ep = [[0] * E for _ in range(C)] if stack_ok else None
    useful = set()
    for video_id, endpoint_id, count in requests:
        ep = endpoints[endpoint_id]
        dc = ep["datacenter_latency"]
        best = dc
        best_c = -1
        for cache_id, lat in ep["caches"].items():
            if video_id in caches[cache_id] and lat < best:
                best = lat
                best_c = cache_id
        vol = sizes[video_id] * count
        if best_c != -1:
            time_saved[best_c] += count * (dc - best)
            data_from_cache[best_c] += vol
            useful.add((best_c, video_id))
            if data_cache_ep is not None:
                data_cache_ep[best_c][endpoint_id] += vol
        else:
            data_dc[endpoint_id] += vol

    wasted = 0
    for cache_id, videos in enumerate(caches):
        for video_id in videos:
            if (cache_id, video_id) not in useful:
                wasted += 1

    matrix = None
    if V * C <= 2500:
        matrix = [[1 if v in caches[c] else 0 for v in range(V)] for c in range(C)]

    dup_videos = [
        {"v": i, "copies": n, "taille": int(sizes[i])}
        for i, n in enumerate(presence)
        if n >= 2
    ]
    dup_videos.sort(key=lambda row: (-row["copies"], -row["taille"]))

    return {
        "remplissage_Mo": fill,
        "occupation_pct": occupation,
        "videos_par_cache": n_videos,
        "moyenne_occupation_pct": round(sum(occupation) / C, 2) if C else 0,
        "copies": copies,
        "videos_uniques_en_cache": unique,
        "copies_en_trop": extra,
        "taux_duplication": round(extra / copies, 4) if copies else 0,
        "taux_videos_dupliquees": round(duplicated_videos / unique, 4) if unique else 0,
        "copies_moyennes": round(copies / unique, 3) if unique else 0,
        "videos_dupliquees": duplicated_videos,
        "histogramme_copies": hist,
        "mo_stockes": mo_stored,
        "mo_uniques": mo_unique,
        "mo_dupliques": mo_extra,
        "taux_mo_dupliques": round(mo_extra / mo_stored, 4) if mo_stored else 0,
        "copies_inutiles": wasted,
        "taux_copies_inutiles": round(wasted / copies, 4) if copies else 0,
        "gain_par_cache": time_saved,
        "volume_dc": data_dc if E <= 400 else [],
        "volume_par_cache": data_from_cache,
        "volume_cache_ep": data_cache_ep,
        "presence": presence if V <= 400 else [],
        "dupliquees": dup_videos[:40],
        "matrice": matrix,
    }


def _zipf(volume) -> list:
    if volume is None or volume.size == 0:
        return []
    ranked = sorted((int(x) for x in volume if x > 0), reverse=True)
    return ranked[: min(120, len(ranked))]


def get_stats(path: Path) -> dict:
    key = str(path)
    with _lock:
        if key in _stats_mem:
            return _stats_mem[key]
    cache_file = CACHE / f"{path.stem}.stats.v{CACHE_VERSION}.json"
    if cache_file.is_file() and cache_file.stat().st_mtime >= path.stat().st_mtime:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        with _lock:
            _stats_mem[key] = data
        return data
    stats = analyze_instance(path)
    data = _jsonable_stats(stats)
    CACHE.mkdir(exist_ok=True)
    cache_file.write_text(json.dumps(data), encoding="utf-8")
    with _lock:
        _stats_mem[key] = data
    return data


def _read_output(out_path: Path, C: int, V: int, sizes, X: int):
    caches = [set() for _ in range(C)]
    warnings = []
    raw = out_path.read_text(encoding="utf-8").strip()
    if not raw:
        return caches, ["Fichier .out vide"]
    lines = raw.splitlines()
    try:
        n_lines = int(lines[0].split()[0])
    except (ValueError, IndexError):
        return caches, ["Premiere ligne du .out invalide"]
    for i, line in enumerate(lines[1:1 + n_lines], start=2):
        parts = line.split()
        if not parts:
            continue
        try:
            nums = list(map(int, parts))
        except ValueError:
            warnings.append(f"Ligne {i} ignoree (non entiere)")
            continue
        cache_id = nums[0]
        if cache_id < 0 or cache_id >= C:
            warnings.append(f"Cache {cache_id} hors limites, ignore")
            continue
        for video_id in nums[1:]:
            if video_id < 0 or video_id >= V:
                warnings.append(f"Video {video_id} hors limites, ignoree")
                continue
            caches[cache_id].add(video_id)
    for cache_id, videos in enumerate(caches):
        used = sum(sizes[v] for v in videos)
        if used > X:
            warnings.append(f"Cache {cache_id} depasse la capacite ({used} Mo > {X} Mo)")
    return caches, warnings


def get_analyse(in_path: Path, out_path: Path) -> dict:
    key = f"{in_path}|{out_path}"
    with _lock:
        if key in _analyse_mem:
            return _analyse_mem[key]
    cache_file = CACHE / f"{in_path.stem}.{out_path.stem}.analyse.v{CACHE_VERSION}.json"
    if (
        cache_file.is_file()
        and cache_file.stat().st_mtime >= in_path.stat().st_mtime
        and cache_file.stat().st_mtime >= out_path.stat().st_mtime
    ):
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        with _lock:
            _analyse_mem[key] = data
        return data

    V, E, R, C, X, sizes, endpoints, requests = read_input(str(in_path))
    caches, warnings = _read_output(out_path, C, V, sizes, X)
    total_plays = sum(n for _v, _e, n in requests)
    ceiling_saved = 0
    for video_id, endpoint_id, count in requests:
        ep = endpoints[endpoint_id]
        dc = ep["datacenter_latency"]
        best = dc
        for lat in ep["caches"].values():
            if lat < best:
                best = lat
        ceiling_saved += (dc - best) * count
    ceiling_score = (ceiling_saved * 1000) // total_plays if total_plays else 0

    score = calculate_score(endpoints, requests, caches)
    details = _solution_details(C, X, V, E, sizes, endpoints, requests, caches)
    n_videos = details["videos_par_cache"]
    saved = sum(details["gain_par_cache"])
    hit_volume = 0
    for video_id, endpoint_id, count in requests:
        ep = endpoints[endpoint_id]
        for cache_id, lat in ep["caches"].items():
            if video_id in caches[cache_id] and lat < ep["datacenter_latency"]:
                hit_volume += count
                break

    data = {
        "fichier_in": in_path.name,
        "fichier_out": out_path.name,
        "V": V,
        "E": E,
        "R": R,
        "C": C,
        "X": X,
        "score": score,
        "score_plafond": ceiling_score,
        "part_plafond": round(score / ceiling_score, 4) if ceiling_score else 0,
        "ms_par_requete": round(saved / total_plays, 3) if total_plays else 0,
        "volume_requetes": total_plays,
        "volume_avec_cache": hit_volume,
        "part_requetes_cachees": round(hit_volume / total_plays, 4) if total_plays else 0,
        "ms_economisees": saved,
        "caches_utilises": sum(1 for n in n_videos if n),
        "avertissements": warnings[:20],
    }
    data.update(details)
    CACHE.mkdir(exist_ok=True)
    cache_file.write_text(json.dumps(data), encoding="utf-8")
    with _lock:
        _analyse_mem[key] = data
    return data


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[dashboard] {self.address_string()} {fmt % args}")

    def _send_json(self, payload, code=200):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/datasets":
            self._send_json({"datasets": _datasets()})
            return
        if path.startswith("/api/stats/"):
            dataset_id = path[len("/api/stats/") :]
            target = _path_from_id(dataset_id)
            if target is None:
                self._send_json({"erreur": "dataset inconnu"}, 404)
                return
            self._send_json(get_stats(target))
            return
        if path.startswith("/api/analyse/"):
            rest = path[len("/api/analyse/") :]
            parts = rest.split("/")
            if len(parts) != 2:
                self._send_json({"erreur": "usage /api/analyse/<in>/<out>"}, 400)
                return
            in_path = _path_from_id(parts[0])
            out_path = _path_from_id(parts[1])
            if in_path is None or out_path is None:
                self._send_json({"erreur": "fichier .in ou .out introuvable"}, 404)
                return
            try:
                self._send_json(get_analyse(in_path, out_path))
            except Exception as exc:
                self._send_json({"erreur": str(exc)}, 500)
            return
        if path in ("/", ""):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)


def main():
    WEB.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Dashboard : http://127.0.0.1:{PORT}", flush=True)
    print("Ctrl+C pour arreter.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArret.")
        server.server_close()


if __name__ == "__main__":
    main()
