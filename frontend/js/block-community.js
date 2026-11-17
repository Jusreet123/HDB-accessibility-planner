(function () {
    const root = document.getElementById("community-panel");
    if (!root) return;

    const CATEGORY_LABELS = {
        mrt_exits: "MRT exit",
        bus_stops: "Bus stop",
        hawker_centres: "Hawker centre",
        childcare_centres: "Childcare centre",
        parks: "Park"
    };

    // Mirrors the attribute rules in backend/routes/community.js
    const ATTRIBUTE_FIELDS = {
        mrt_exits: [
            { key: "lift_access", label: "Lift access", type: "checkbox" },
            { key: "description", label: "Description", type: "text" }
        ],
        bus_stops: [
            { key: "sheltered", label: "Sheltered", type: "checkbox" },
            { key: "services", label: "Bus services", type: "list", hint: "comma separated" },
            { key: "description", label: "Description", type: "text" }
        ],
        hawker_centres: [
            { key: "cuisine", label: "Cuisine", type: "text" },
            { key: "halal", label: "Halal", type: "checkbox" },
            { key: "opening_hours", label: "Opening hours", type: "text" },
            { key: "description", label: "Description", type: "text" }
        ],
        childcare_centres: [
            { key: "programmes", label: "Programmes", type: "list", hint: "comma separated" },
            { key: "opening_hours", label: "Opening hours", type: "text" },
            { key: "description", label: "Description", type: "text" }
        ],
        parks: [
            { key: "facilities", label: "Facilities", type: "list", hint: "comma separated" },
            { key: "description", label: "Description", type: "text" }
        ]
    };

    const ATTRIBUTE_LABELS = {};
    for (const fields of Object.values(ATTRIBUTE_FIELDS)) {
        for (const field of fields) ATTRIBUTE_LABELS[field.key] = field.label;
    }

    let blockId = null;
    let blockLocation = null;
    let places = [];
    let map = null;
    let layer = null;
    let pickMarker = null;
    let picking = false;
    let showOnMap = true;
    let attributeInputs = {};

    // Builds DOM elements. User text is only ever set with textContent.
    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);

        for (const [key, value] of Object.entries(props)) {
            if (key === "text") node.textContent = value;
            else if (key in node) node[key] = value;
            else node.setAttribute(key, value);
        }

        node.append(...children);
        return node;
    }

    // ---------- page skeleton ----------

    const summary = el("p");
    const nameInput = el("input", { type: "text", maxLength: 100, required: true, placeholder: "Place name" });
    const categorySelect = el("select");

    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
        categorySelect.append(el("option", { value, text: label }));
    }

    const latInput = el("input", { type: "number", step: "any", required: true, placeholder: "Latitude" });
    const lngInput = el("input", { type: "number", step: "any", required: true, placeholder: "Longitude" });
    const useBlockButton = el("button", { type: "button", text: "Use block location" });
    const pickButton = el("button", { type: "button", text: "Pick on map" });
    const attributeBox = el("div");
    const submitButton = el("button", { type: "submit", text: "Add place" });
    const message = el("p", { role: "alert" });
    const list = el("ul");

    const form = el(
        "form",
        {},
        el("label", {}, "Name ", nameInput),
        el("label", {}, "Category ", categorySelect),
        el("div", {}, latInput, lngInput, useBlockButton, pickButton),
        attributeBox,
        submitButton
    );

    root.append(
        el("p", { text: "Places added by residents are unverified and are not part of the official data." }),
        summary,
        form,
        message,
        list
    );

    // ---------- helpers ----------

    function currentRadius() {
        const select = document.getElementById("amenitiesRadius");
        return select ? Number(select.value) || 500 : 500;
    }

    function renderAttributeFields() {
        attributeBox.replaceChildren();
        attributeInputs = {};

        for (const field of ATTRIBUTE_FIELDS[categorySelect.value]) {
            const input = el("input", {
                type: field.type === "checkbox" ? "checkbox" : "text",
                placeholder: field.hint || ""
            });

            if (field.type !== "checkbox") input.maxLength = 200;

            attributeInputs[field.key] = { field, input };
            attributeBox.append(el("label", {}, `${field.label} `, input));
        }
    }

    function readAttributes() {
        const attributes = {};

        for (const [key, { field, input }] of Object.entries(attributeInputs)) {
            if (field.type === "checkbox") {
                if (input.checked) attributes[key] = true;
            } else if (field.type === "list") {
                const items = input.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .slice(0, 10);

                if (items.length) attributes[key] = items;
            } else if (input.value.trim()) {
                attributes[key] = input.value.trim();
            }
        }

        return attributes;
    }

    function describe(attributes) {
        const parts = [];

        for (const [key, value] of Object.entries(attributes || {})) {
            const label = ATTRIBUTE_LABELS[key] || key;

            if (value === true) parts.push(label);
            else if (Array.isArray(value)) parts.push(`${label}: ${value.join(", ")}`);
            else if (value !== false) parts.push(`${label}: ${value}`);
        }

        return parts.join(" | ");
    }

    async function api(method, url, body) {
        const response = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            credentials: "same-origin"
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(data.error || response.statusText);
            error.status = response.status;
            throw error;
        }

        return data;
    }

    function showMessage(error) {
        message.replaceChildren();

        if (!error) return;

        if (error.status === 401) {
            const link = el("a", { href: "login.html", text: "log in" });
            message.append("Please ", link, " to add or manage community places.");
        } else {
            message.textContent = error.message;
        }
    }

    async function act(action) {
        try {
            await action();
            showMessage(null);
            await refresh();
        } catch (error) {
            showMessage(error);
        }
    }

    function useBlockLocation() {
        if (!blockLocation) return;

        latInput.value = blockLocation.lat.toFixed(6);
        lngInput.value = blockLocation.lng.toFixed(6);
    }

    // ---------- list ----------

    function renderList() {
        list.replaceChildren();

        for (const p of places) {
            const li = el("li");

            li.append(
                el("strong", { text: p.name }),
                " ",
                el("span", { className: "community-badge", text: "Community" }),
                " ",
                el("span", { text: `${CATEGORY_LABELS[p.category] || p.category} | ${p.distance_m} m` })
            );

            const details = describe(p.attributes);
            if (details) li.append(el("div", { text: details }));

            if (p.mine) {
                const edit = el("button", { type: "button", text: "Edit" });
                edit.addEventListener("click", () => {
                    const name = prompt("Edit the place name", p.name);
                    if (name === null) return;

                    const description = prompt(
                        "Edit the description (leave empty to remove it)",
                        (p.attributes && p.attributes.description) || ""
                    );
                    if (description === null) return;

                    const attributes = { ...(p.attributes || {}) };
                    if (description.trim()) attributes.description = description.trim();
                    else delete attributes.description;

                    act(() => api("PUT", `/api/community-places/${p.id}`, { name, attributes }));
                });

                const del = el("button", { type: "button", text: "Delete" });
                del.addEventListener("click", () => {
                    if (confirm("Delete this place?")) {
                        act(() => api("DELETE", `/api/community-places/${p.id}`));
                    }
                });

                li.append(" ", edit, " ", del);
            }

            list.append(li);
        }
    }

    // ---------- map ----------

    function renderMarkers() {
        if (!map || !layer || !window.L) return;

        layer.clearLayers();

        for (const p of places) {
            const popup = el(
                "div",
                {},
                el("strong", { text: p.name }),
                el("br"),
                `${CATEGORY_LABELS[p.category] || p.category} | ${p.distance_m} m`,
                el("br"),
                el("em", { text: "Community-submitted, unverified" })
            );

            L.circleMarker([p.lat, p.lng], {
                radius: 8,
                color: "#0F766E",
                weight: 2,
                fillColor: "#14B8A6",
                fillOpacity: 0.85
            })
                .bindPopup(popup)
                .addTo(layer);
        }
    }

    function addLegendToggle() {
        const options = document.querySelector("#mapLegend .map-legend-options");

        if (!options || document.getElementById("communityMapToggle")) return;

        const input = el("input", { type: "checkbox", id: "communityMapToggle", checked: true });
        input.addEventListener("change", () => {
            showOnMap = input.checked;
            applyLayerVisibility();
        });

        const dot = el("span", { className: "map-legend-dot" });
        dot.style.backgroundColor = "#14B8A6";
        dot.setAttribute("aria-hidden", "true");

        options.append(
            el("label", { className: "map-legend-option" }, input, dot, el("span", { text: "Community places" }))
        );
    }

    // When community places are merged into the official lists, block.js draws them itself,
    // so this panel's own markers are hidden to avoid showing every place twice.
    function applyLayerVisibility() {
        if (!map || !layer) return;

        const mergedToggle = document.getElementById("includeCommunityPlaces");
        const merged = Boolean(mergedToggle && mergedToggle.checked);

        if (showOnMap && !merged) {
            if (!map.hasLayer(layer)) layer.addTo(map);
        } else if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    }
    
    function attachMap(newMap) {
        if (!window.L || !newMap) return;

        map = newMap;
        layer = L.layerGroup();

        applyLayerVisibility();

        renderMarkers();
        addLegendToggle();
    }

    // ---------- loading ----------

    async function refresh() {
        if (!blockId) return;

        const radius = currentRadius();
        const data = await api("GET", `/api/community-places/near-block/${blockId}?radius=${radius}&limit=20`);

        places = data.places;

        summary.textContent = places.length
            ? `${places.length} community place(s) within ${radius} m`
            : `No community places within ${radius} m yet. Be the first to add one.`;

        renderList();
        renderMarkers();
    }

    async function setBlock(id) {
        const number = Number(id);

        if (!Number.isSafeInteger(number) || number <= 0) return;

        blockId = number;

        try {
            const details = await api("GET", `/api/blocks/${blockId}`);
            const b = details.block;

            if (b && b.latitude != null && b.longitude != null) {
                blockLocation = { lat: Number(b.latitude), lng: Number(b.longitude) };

                if (!latInput.value && !lngInput.value) useBlockLocation();
            }
        } catch (error) {
            // The form still works with typed coordinates
        }

        await refresh();
    }

    // ---------- events ----------

    categorySelect.addEventListener("change", renderAttributeFields);
    useBlockButton.addEventListener("click", useBlockLocation);

    pickButton.addEventListener("click", () => {
        if (!map) {
            showMessage(new Error("The map is not ready yet. Type the coordinates instead."));
            return;
        }

        if (picking) return;

        picking = true;
        pickButton.textContent = "Now click the map...";

        const mapBox = document.getElementById("neighbourhoodMap");
        if (mapBox) mapBox.scrollIntoView({ behavior: "smooth", block: "center" });

        map.once("click", (event) => {
            picking = false;
            pickButton.textContent = "Pick on map";

            latInput.value = event.latlng.lat.toFixed(6);
            lngInput.value = event.latlng.lng.toFixed(6);

            if (pickMarker) map.removeLayer(pickMarker);

            pickMarker = L.circleMarker(event.latlng, {
                radius: 10,
                color: "#B91C1C",
                weight: 3,
                fillOpacity: 0.15
            }).addTo(map);

            root.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        if (!blockId) {
            showMessage(new Error("No block selected."));
            return;
        }

        act(async () => {
            await api("POST", "/api/community-places", {
                name: nameInput.value,
                category: categorySelect.value,
                lat: latInput.value,
                lng: lngInput.value,
                attributes: readAttributes()
            });

            nameInput.value = "";
            renderAttributeFields();

            if (pickMarker && map) {
                map.removeLayer(pickMarker);
                pickMarker = null;
            }
        });
    });

    const radiusSelect = document.getElementById("amenitiesRadius");
    if (radiusSelect) {
        radiusSelect.addEventListener("change", () => refresh().catch(showMessage));
        const mergedToggle = document.getElementById("includeCommunityPlaces");
        if (mergedToggle) mergedToggle.addEventListener("change", applyLayerVisibility);
    }

    // ---------- start ----------

    renderAttributeFields();

    if (window.havenMap) attachMap(window.havenMap);
    document.addEventListener("haven:map-ready", (event) => attachMap(event.detail.map));

    window.setCommunityBlock = (id) => setBlock(id).catch(showMessage);

    // The block ID comes from the page address, whatever the parameter is called
    const params = new URLSearchParams(window.location.search);
    let fromUrl =
        params.get("block_id") || params.get("blockId") ||
        params.get("id") || params.get("block");

    if (!fromUrl) {
        for (const value of params.values()) {
            if (/^\d+$/.test(value)) {
                fromUrl = value;
                break;
            }
        }
    }

    if (fromUrl) window.setCommunityBlock(fromUrl);
})();