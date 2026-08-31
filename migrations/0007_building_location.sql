-- Building location for the map picker (OpenStreetMap/Leaflet — no API key,
-- no billing account, per the decision to not wait on a Google Maps key).
ALTER TABLE buildings ADD COLUMN latitude REAL;
ALTER TABLE buildings ADD COLUMN longitude REAL;
