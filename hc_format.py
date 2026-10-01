"""Lecture du format officiel Hash Code 2017 — Streaming Videos."""


def read_input(source):
    close = False
    if hasattr(source, "readline"):
        file = source
    else:
        file = open(source, "r", encoding="utf-8")
        close = True

    try:
        V, E, R, C, X = map(int, file.readline().split())
        video_sizes = list(map(int, file.readline().split()))

        endpoints = []
        for _ in range(E):
            datacenter_latency, number_of_caches = map(int, file.readline().split())
            connected_caches = {}
            for _ in range(number_of_caches):
                cache_id, cache_latency = map(int, file.readline().split())
                connected_caches[cache_id] = cache_latency
            endpoints.append({
                "datacenter_latency": datacenter_latency,
                "caches": connected_caches,
            })

        requests = []
        for _ in range(R):
            video_id, endpoint_id, number_of_requests = map(int, file.readline().split())
            requests.append((video_id, endpoint_id, number_of_requests))
    finally:
        if close:
            file.close()

    return V, E, R, C, X, video_sizes, endpoints, requests
