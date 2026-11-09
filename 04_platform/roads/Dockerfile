# ROAD DISTANCES (2026-11-08 — zone pricing step 4 and route optimization; the owner: "Same server", and the Netherlands
# matched during testing).
#
# OSRM, the open routing engine, with the roads of every country the network routes in (Kenya and the Netherlands to
# start — .github/workflows/roads.yml lists them) already prepared inside: the map is made by the GitHub pipeline every
# week, never on a laptop, and this image only carries it. The API asks it for distances by road
# (src/modules/pudo/road-matrix.ts, the OSRM table protocol) where the server's .env says GLOS_ROUTER_URL=http://osrm:5000;
# the stack starts it where .env says COMPOSE_PROFILES=roads.
#
# Map data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
FROM ghcr.io/project-osrm/osrm-backend:v5.27.1

COPY roads.osrm* /data/
EXPOSE 5000
# A table of every zone to every other is one request: a self-hosted engine may answer more than the public one's 100.
CMD ["osrm-routed", "--algorithm", "mld", "--max-table-size", "1000", "/data/roads.osrm"]
