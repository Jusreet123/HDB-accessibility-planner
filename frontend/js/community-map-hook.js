// Loaded BEFORE block.js so it can capture the Leaflet map when block.js creates it.
(function () {
    if (!window.L || !L.Map || typeof L.Map.addInitHook !== "function") return;

    L.Map.addInitHook(function () {
        window.havenMap = this;
        document.dispatchEvent(
            new CustomEvent("haven:map-ready", { detail: { map: this } })
        );
    });
})();