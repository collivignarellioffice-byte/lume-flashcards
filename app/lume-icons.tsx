"use client";

import { useMemo, useState, type CSSProperties } from "react";

type IconOption = { name: string; label: string };
type IconGroup = { name: string; icons: IconOption[] };

export const iconGroups: IconGroup[] = [
  {
    name: "Studio",
    icons: [
      ["book-2", "Libro"], ["books", "Libri"], ["notebook", "Quaderno"], ["notes", "Appunti"],
      ["writing", "Scrittura"], ["pencil", "Matita"], ["school", "Studio"], ["certificate", "Certificato"],
      ["vocabulary", "Vocabolario"], ["language", "Lingue"], ["abc", "Alfabeto"], ["alphabet-latin", "Lettere"],
      ["bookmark", "Segnalibro"], ["file-text", "Documento"], ["presentation", "Presentazione"], ["library", "Biblioteca"],
    ].map(([name, label]) => ({ name, label })),
  },
  {
    name: "Scienze",
    icons: [
      ["brain", "Cervello"], ["microscope", "Microscopio"], ["flask", "Laboratorio"], ["test-pipe", "Provetta"],
      ["atom", "Atomo"], ["dna", "DNA"], ["heartbeat", "Salute"], ["stethoscope", "Medicina"],
      ["plant", "Pianta"], ["leaf", "Natura"], ["telescope", "Telescopio"], ["planet", "Pianeta"],
      ["rocket", "Spazio"], ["math", "Matematica"], ["calculator", "Calcolatrice"], ["ruler-measure", "Misure"],
    ].map(([name, label]) => ({ name, label })),
  },
  {
    name: "Creatività",
    icons: [
      ["palette", "Tavolozza"], ["brush", "Pennello"], ["camera", "Fotografia"], ["photo", "Immagine"],
      ["music", "Musica"], ["microphone", "Voce"], ["movie", "Cinema"], ["code", "Codice"],
      ["device-laptop", "Computer"], ["binary-tree", "Struttura"], ["robot", "Robot"], ["bulb", "Idea"],
      ["shape", "Forme"], ["puzzle", "Puzzle"], ["chess", "Scacchi"], ["quote", "Citazione"],
    ].map(([name, label]) => ({ name, label })),
  },
  {
    name: "Umanistiche",
    icons: [
      ["world", "Mondo"], ["map", "Mappa"], ["globe", "Geografia"], ["history", "Storia"],
      ["building-bank", "Istituzioni"], ["scale", "Diritto"], ["gavel", "Legge"], ["message", "Comunicazione"],
      ["messages", "Dialogo"], ["users", "Società"], ["speakerphone", "Media"], ["building-community", "Comunità"],
      ["building-monument", "Monumento"], ["timeline", "Cronologia"], ["news", "Notizie"], ["writing-sign", "Segni"],
    ].map(([name, label]) => ({ name, label })),
  },
  {
    name: "Lavoro",
    icons: [
      ["briefcase", "Lavoro"], ["chart-bar", "Grafico"], ["graph", "Analisi"], ["target", "Obiettivo"],
      ["trophy", "Traguardo"], ["medal", "Risultato"], ["calendar", "Calendario"], ["clock", "Tempo"],
      ["checklist", "Checklist"], ["list-details", "Elenco"], ["database", "Database"], ["archive", "Archivio"],
      ["folders", "Cartelle"], ["tags", "Etichette"], ["flag", "Bandiera"], ["star", "Preferito"],
    ].map(([name, label]) => ({ name, label })),
  },
  {
    name: "Vita",
    icons: [
      ["heart", "Cuore"], ["sun", "Sole"], ["moon", "Luna"], ["cloud", "Nuvola"],
      ["mountain", "Montagna"], ["beach", "Mare"], ["bike", "Bicicletta"], ["car", "Auto"],
      ["plane", "Aereo"], ["train", "Treno"], ["chef-hat", "Cucina"], ["coffee", "Caffè"],
      ["apple", "Alimentazione"], ["dog", "Cane"], ["cat", "Gatto"], ["flower", "Fiore"],
    ].map(([name, label]) => ({ name, label })),
  },
];

const availableIcons = new Set(iconGroups.flatMap((group) => group.icons.map((icon) => icon.name)));

export function normalizeLumeIcon(value: unknown, fallback: "folder" | "book-2" = "book-2") {
  return typeof value === "string" && (availableIcons.has(value) || value === "folder") ? value : fallback;
}

export function TablerIcon({ name, className = "", label }: { name: string; className?: string; label?: string }) {
  const base = import.meta.env.BASE_URL || "/";
  const safeName = /^[a-z0-9-]+$/.test(name) ? name : "book-2";
  return (
    <span
      className={`tabler-icon ${className}`.trim()}
      style={{ "--tabler-icon-url": `url("${base}tabler-icons/${safeName}.svg")` } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function IconChoiceButton({ icon, color, onClick, label = "Scegli icona" }: { icon: string; color: string; onClick: () => void; label?: string }) {
  const selected = iconGroups.flatMap((group) => group.icons).find((item) => item.name === icon);
  return (
    <button className="icon-choice-button" type="button" onClick={onClick} style={{ "--icon-choice-color": color } as CSSProperties}>
      <TablerIcon name={icon} />
      <span><small>Icona</small><strong>{selected?.label ?? "Cartella"}</strong></span>
      <em>{label}</em>
    </button>
  );
}

export function IconPicker({ selected, color, kind, onSelect, onClose }: { selected: string; color: string; kind: "folder" | "deck"; onSelect: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Tutte");
  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("it");
    return iconGroups
      .filter((item) => group === "Tutte" || item.name === group)
      .map((item) => ({
        ...item,
        icons: item.icons.filter((icon) => !normalized || `${icon.label} ${icon.name}`.toLocaleLowerCase("it").includes(normalized)),
      }))
      .filter((item) => item.icons.length);
  }, [group, query]);

  return (
    <div className="modal-backdrop-clean icon-picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="icon-picker-modal" style={{ "--icon-choice-color": color } as CSSProperties}>
        <header>
          <div><span>Libreria Tabler</span><h2>Scegli l’icona {kind === "folder" ? "della cartella" : "del set"}.</h2></div>
          <button className="round-close" type="button" onClick={onClose} aria-label="Chiudi">×</button>
        </header>
        <label className="icon-search"><TablerIcon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un’icona…" /></label>
        <nav className="icon-category-tabs" aria-label="Categorie di icone">
          {["Tutte", ...iconGroups.map((item) => item.name)].map((name) => <button className={group === name ? "active" : ""} type="button" key={name} onClick={() => setGroup(name)}>{name}</button>)}
        </nav>
        <div className="icon-picker-results">
          {visibleGroups.map((item) => <section key={item.name}><h3>{item.name}</h3><div>{item.icons.map((icon) => <button className={selected === icon.name ? "selected" : ""} type="button" key={icon.name} onClick={() => { onSelect(icon.name); onClose(); }} title={icon.label} aria-label={icon.label}><TablerIcon name={icon.name} /><span>{icon.label}</span></button>)}</div></section>)}
          {!visibleGroups.length && <p>Nessuna icona corrisponde alla ricerca.</p>}
        </div>
        <footer><span>96 icone coerenti, ottimizzate anche per la modalità scura.</span><button type="button" onClick={onClose}>Annulla</button></footer>
      </section>
    </div>
  );
}
