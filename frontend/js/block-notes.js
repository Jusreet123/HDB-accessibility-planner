(function () {
    const root = document.getElementById("notes-panel");
    if (!root) return;

    let blockId = null;

    // The fixed skeleton uses innerHTML. User-written text is only ever set with textContent.
    root.innerHTML = `
        <p id="np-summary"></p>
        <form id="np-form">
            <textarea id="np-note" placeholder="Share a note about this block" maxlength="500" required></textarea>
            <button type="submit">Add note</button>
        </form>
        <p id="np-message" role="alert"></p>
        <ul id="np-list"></ul>`;

    const $ = (id) => root.querySelector("#" + id);

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
        const box = $("np-message");
        box.replaceChildren();

        if (!error) return;

        if (error.status === 401) {
            const link = document.createElement("a");
            link.href = "login.html";
            link.textContent = "log in";
            box.append("Please ", link, " to add or manage notes.");
        } else {
            box.textContent = error.message;
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

    async function refresh() {
        if (!blockId) return;

        const [list, summary] = await Promise.all([
            api("GET", `/api/notes?block_id=${blockId}`),
            api("GET", `/api/notes/summary/${blockId}`)
        ]);

        $("np-summary").textContent = summary.notes 
            ? `${summary.notes} community note${summary.notes === 1 ? '' : 's'}` 
            : "No notes yet. Be the first to share!";

        const listEl = $("np-list");
        listEl.replaceChildren();

        if (!list.notes.length) {
            return; // We show the "No notes yet" in the summary instead
        }

        for (const n of list.notes) {
            const li = document.createElement("li");
            
            // Note content wrapper (matches the new CSS layout)
            const contentDiv = document.createElement("div");
            const date = new Date(n.created_at).toLocaleDateString();
            contentDiv.textContent = `${n.mine ? "You" : "Resident"} on ${date}: ${n.note}`;
            
            li.appendChild(contentDiv);

            if (n.mine) {
                const edit = document.createElement("button");
                edit.type = "button";
                edit.textContent = "Edit";
                edit.onclick = () => {
                    const newNote = prompt("Edit your note", n.note);
                    if (newNote === null) return;

                    const body = { note: newNote };
                    act(() => api("PUT", `/api/notes/${n.id}`, body));
                };

                const del = document.createElement("button");
                del.type = "button";
                del.textContent = "Delete";
                del.onclick = () => {
                    if (confirm("Delete this note?")) {
                        act(() => api("DELETE", `/api/notes/${n.id}`));
                    }
                };

                li.append(edit, del);
            }

            listEl.append(li);
        }
    }

    $("np-form").addEventListener("submit", (event) => {
        event.preventDefault();

        if (!blockId) {
            showMessage(new Error("No block selected."));
            return;
        }

        act(async () => {
            await api("POST", "/api/notes", {
                block_id: blockId,
                note: $("np-note").value
            });

            $("np-note").value = "";
        });
    });

    // Call window.setNotesBlock(id) whenever the page learns which block is shown
    window.setNotesBlock = function (id) {
        const number = Number(id);

        if (!Number.isSafeInteger(number) || number <= 0) return;

        blockId = number;
        refresh().catch(showMessage);
    };

    // Fallback: read the block ID from the page address, whatever the parameter is called
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

    if (fromUrl) window.setNotesBlock(fromUrl);
})();