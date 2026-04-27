#!usrbinenv python3
# -- coding utf-8 --

codedump_from_zip.py (v3, Presets)
----------------------------------
Erzeugt aus einer ZIP-Projektdatei eine Markdown-Datei (codedump.md)
mit allen Dateien. Enthält
- Binär-Erkennung (Heuristik + Magic-Header)
- Konfigurierbare Binärbehandlung skip  hex  base64  bytes
- Parallelisierung (ThreadPool; pro Task eigener Zip-Handle)
- Include-Exclude-Filter (Glob-Patterns)
- Maximalgröße pro Datei (--max-size)
- Metadaten, Sortierung, Newline-Steuerung
- Presets vordefinierte FilterDefaults für typische Projektarten


from __future__ import annotations

import argparse
import base64
import binascii
import concurrent.futures as futures
import fnmatch
import sys
import zipfile
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

# chardet ist optional (für Encoding-Erkennung)
try
    import chardet  # type ignore
except Exception
    chardet = None  # type ignore


# =============================== Konfiguration ===============================

BinaryMode = str  # skip  hex  base64  bytes

@dataclass(frozen=True)
class DumpOptions
    zip_path Path
    output_path Path
    include tuple[str, ...]
    exclude tuple[str, ...]
    max_size int  None
    binaries BinaryMode
    show_metadata bool
    workers int
    sort str  # path  size  time
    newline str  # n oder rn
    strict_text bool


# ---- Presets ----------------------------------------------------------------
# Jedes Preset kann includeexcludemax_sizebinariesshow_metadataworkerssortnewlinestrict_text setzen.
# Anwenden Optionen werden VEREINIGT (IncludesExcludes gemerged).
# Explizit via CLI gesetzte Werte gewinnen gegenüber Presets.

PRESET_MAP dict[str, dict] = {
    # Allgemeine Vollständigkeit, aber übliche Schrottverzeichnisse raus
    full-stack {
        include [],
        exclude [
            .git, .github, .gitlab,
            .idea, .vscode,
            __pycache__, .mypy_cache, .pytest_cache,
            .ruff_cache, .cache,
            node_modules, dist, build, .parcel-cache, .next, .nuxt,
            coverage, reports, site,
            target, bin, obj,
            .venv, venv, env,
            .lock, package-lock.json, yarn.lock, pnpm-lock.yaml,
        ],
        max_size 2_000_000,  # 2 MB pro Datei
        binaries skip,
        show_metadata True,
        sort path,
    },

    python-web {
        include [.py, .toml, .ini, .cfg, .conf,
                    .md, .txt, .json, .yaml, .yml,
                    templates.html, static],
        exclude [
            .venv, venv, env,
            __pycache__, .mypy_cache, .pytest_cache,
            dist, build, .cache,
        ],
        max_size 1_000_000,
        binaries skip,
    },

    fastapi {
        include [.py, .toml, .ini, .cfg, .conf,
                    .md, .json, .yaml, .yml,
                    templates.html, static],
        exclude [.venv, __pycache__, .mypy_cache,
                    .pytest_cache, dist, build],
        max_size 1_000_000,
        binaries skip,
    },

    streamlit {
        include [.py, .md, .json, .yaml, .yml,
                    .toml, assets],
        exclude [.venv, __pycache__, .cache, dist, build],
        max_size 800_000,
    },

    node-app {
        include [.js, .cjs, .mjs, .ts, .json,
                    .md, .yaml, .yml, .env, .env],
        exclude [node_modules, dist, build, .parcel-cache,
                    .next, .nuxt, coverage,
                    .lock, package-lock.json, yarn.lock, pnpm-lock.yaml],
        max_size 1_000_000,
        binaries skip,
    },

    react {
        include [.tsx, .ts, .jsx, .js, .css, .scss,
                    .html, .json, .md, .yaml, .yml],
        exclude [node_modules, dist, build, .parcel-cache,
                    .next, .nuxt, coverage],
        max_size 800_000,
        binaries skip,
    },

    data-science {
        include [.py, .ipynb, .md, .txt, .csv,
                    .json, .yaml, .yml, .toml],
        exclude [.venv, __pycache__, .ipynb_checkpoints,
                    wandb, mlruns, data, datasets,
                    dist, build],
        max_size 1_500_000,
        binaries skip,
    },

    rust-crate {
        include [.rs, Cargo.toml, Cargo.lock, .md, .yaml, .yml],
        exclude [target, dist],
        max_size 800_000,
    },

    java-maven {
        include [.java, pom.xml, .md, .yaml, .yml, .xml, .properties],
        exclude [target, out, .idea],
        max_size 1_000_000,
    },

    dotnet {
        include [.cs, .csproj, .sln, .json, .md, .yaml, .yml],
        exclude [bin, obj],
        max_size 1_000_000,
    },
}

DEFAULT_EXCLUDES = [
    .git, .github, .gitlab,
    .idea, .vscode,
    __pycache__, .mypy_cache, .pytest_cache, .ruff_cache,
    .cache, node_modules, dist, build, .parcel-cache,
    .next, .nuxt, coverage, site,
    target, bin, obj,
    .venv, venv, env,
]


# =============================== Utilities ==================================

def guess_language(p Path) - str
    match p.suffix.lower()
        case .py return python
        case .ipynb return json
        case .js return javascript
        case .ts return typescript
        case .jsx return jsx
        case .tsx return tsx
        case .java return java
        case .kt return kotlin
        case .rs return rust
        case .go return go
        case .cpp  .cc  .cxx return cpp
        case .c return c
        case .cs return csharp
        case .php return php
        case .rb return ruby
        case .swift return swift
        case .m  .mm return objective-c
        case .scala return scala
        case .sh  .bash return bash
        case .ps1 return powershell
        case .bat  .cmd return batch
        case .html  .htm return html
        case .css return css
        case .scss  .sass return scss
        case .md return markdown
        case .json return json
        case .toml return toml
        case .ini  .cfg  .conf return ini
        case .yaml  .yml return yaml
        case .xml return xml
        case .sql return sql
        case .csv return csv
        case .txt   return 
        case _
            return 


def is_probably_binary(data bytes, filename str) - bool
    if bx00 in data[4096]
        return True
    magic = (
        (bx89PNGrnx1an,),
        (bxffxd8xff,),
        (bGIF87a, bGIF89a),
        (b%PDF-,),
        (bPKx03x04, bPKx05x06, bPKx07x08),
        (bx7fELF,),
        (bMZ,),
        (bID3,),
        (bIIx00, bMMx00),
        (bRIFF,),
        (bOggS, bOGG),
        (bx1fx8bx08,),
    )
    head = data[16]
    for variants in magic
        if any(head.startswith(m) for m in variants)
            return True

    text_bytes = set(range(32, 256)) - {127}
    text_bytes.update({9, 10, 13})
    sample = data[8192]
    nontext = sum(b not in text_bytes for b in sample)
    return nontext  max(1, len(sample))  0.30


def detect_encoding(data bytes) - str  None
    if chardet is None
        return None
    result = chardet.detect(data)
    enc = result.get(encoding)
    if not enc or (result.get(confidence) or 0.0)  0.4
        return None
    return enc


def decode_text(data bytes, strict_text bool) - str  None
    enc = detect_encoding(data)
    if enc
        try
            return data.decode(enc)
        except Exception
            if strict_text
                return None
    try
        return data.decode(utf-8, errors=(strict if strict_text else replace))
    except Exception
        return None


def should_skip(filename str, include Iterable[str], exclude Iterable[str]) - bool
    posix = filename.replace(, )
    if include
        if not any(fnmatch.fnmatch(posix, pat) for pat in include)
            return True
    # Standard-Excludes plus benutzerdefinierte
    all_excludes = list(DEFAULT_EXCLUDES) + list(exclude)
    if any(fnmatch.fnmatch(posix, pat) for pat in all_excludes)
        return True
    return False


def fmt_dt(zipinfo zipfile.ZipInfo) - str
    dt = datetime(zipinfo.date_time, tzinfo=timezone.utc)
    return dt.strftime(%Y-%m-%d %H%M%S UTC)


def sort_key(kind str, info zipfile.ZipInfo) - tuple
    match kind
        case size
            return (info.file_size, info.filename)
        case time
            return (info.date_time, info.filename)
        case _
            return (info.filename,)


# ============================ Preset-Verarbeitung ============================

def apply_presets(base DumpOptions, presets list[str], cli_overrides dict) - DumpOptions
    
    Wendet Presets nacheinander an. IncludesExcludes werden vereinigt,
    andere Felder nur gesetzt, wenn nicht per CLI explizit überschrieben.
    Reihenfolge der Presets ist relevant (spätere können Defaults ändern).
    
    include = set(base.include)
    exclude = set(base.exclude)
    opt = base

    for name in presets
        p = PRESET_MAP.get(name)
        if not p
            print(f⚠️  Unbekanntes Preset ignoriert {name}, file=sys.stderr)
            continue

        include.update(p.get(include, []))
        exclude.update(p.get(exclude, []))

        # Nur setzen, wenn nicht via CLI überschrieben
        if max_size in p and cli_overrides.get(max_size) is None and opt.max_size is None
            opt = replace(opt, max_size=p[max_size])
        if binaries in p and cli_overrides.get(binaries) is None
            opt = replace(opt, binaries=p[binaries])
        if show_metadata in p and cli_overrides.get(show_metadata) is None and opt.show_metadata is False
            opt = replace(opt, show_metadata=p[show_metadata])
        if workers in p and cli_overrides.get(workers) is None and opt.workers == 8
            opt = replace(opt, workers=p[workers])
        if sort in p and cli_overrides.get(sort) is None and opt.sort == path
            opt = replace(opt, sort=p[sort])
        if newline in p and cli_overrides.get(newline) is None
            opt = replace(opt, newline=p[newline])
        if strict_text in p and cli_overrides.get(strict_text) is None and opt.strict_text is False
            opt = replace(opt, strict_text=p[strict_text])

    opt = replace(opt, include=tuple(sorted(include)), exclude=tuple(sorted(exclude)))
    return opt


# ================================ Kern-IO ====================================

def read_entry_task(zip_path Path, info zipfile.ZipInfo, options DumpOptions) - tuple[str, str]
    with zipfile.ZipFile(zip_path, r) as zf
        data = zf.read(info.filename)

    p = Path(info.filename)
    lang = guess_language(p)

    meta_lines list[str] = []
    if options.show_metadata
        meta_lines = [
            f- Pfad `{p.as_posix()}`,
            f- Größe {info.file_size} Bytes,
            f- Geändert {fmt_dt(info)},
        ]

    if options.max_size is not None and info.file_size  options.max_size
        details = n.join(meta_lines) if meta_lines else 
        md = (
            f## Datei `{p.as_posix()}`  n
            f{details}nn
            f Übersprungen Datei größer als --max-size ({options.max_size} B).nn
        )
        return info.filename, md

    if is_probably_binary(data, info.filename)
        match options.binaries
            case skip
                details = n.join(meta_lines) if meta_lines else 
                md = (
                    f## Datei `{p.as_posix()}`  n
                    f{details}nn
                    f Binärdatei – Ausgabe übersprungen (Modus skip).nn
                )
                return info.filename, md
            case hex
                dump = binascii.hexlify(data).decode(ascii)
                details = n.join(meta_lines + [- Modus hex]) if meta_lines else - Modus hex
                md = (
                    f## Datei `{p.as_posix()}`  n
                    f{details}nn
                    f```textn{dump}n```nn
                )
                return info.filename, md
            case base64
                dump = base64.b64encode(data).decode(ascii)
                details = n.join(meta_lines + [- Modus base64]) if meta_lines else - Modus base64
                md = (
                    f## Datei `{p.as_posix()}`  n
                    f{details}nn
                    f```textn{dump}n```nn
                )
                return info.filename, md
            case bytes
                snippet = repr(data[65536])
                more = … (gekürzt) if len(data)  65536 else 
                details = n.join(meta_lines + [- Modus bytes]) if meta_lines else - Modus bytes
                md = (
                    f## Datei `{p.as_posix()}`  n
                    f{details}nn
                    f```textn{snippet}{more}n```nn
                )
                return info.filename, md
            case _
                details = n.join(meta_lines) if meta_lines else 
                md = (
                    f## Datei `{p.as_posix()}`  n
                    f{details}nn
                    f Binärdatei – unbekannter Modus, daher übersprungen.nn
                )
                return info.filename, md

    text = decode_text(data, strict_text=options.strict_text)
    if text is None
        details = n.join(meta_lines) if meta_lines else 
        md = (
            f## Datei `{p.as_posix()}`  n
            f{details}nn
            f Warnung Textdecodierung fehlgeschlagen (strict mode aktiv). Datei übersprungen.nn
        )
        return info.filename, md

    if not text.endswith(options.newline)
        text += options.newline

    hdr = [f## Datei `{p.as_posix()}`]
    if meta_lines
        hdr.append(  n + n.join(meta_lines))
    hdr.append(n)

    block = .join([
        n.join(hdr),
        f```{lang}n,
        text,
        ```nn
    ])
    return info.filename, block


def create_codedump(options DumpOptions) - None
    try
        with zipfile.ZipFile(options.zip_path, r) as zf
            infos = [i for i in zf.infolist() if not i.is_dir()]
    except FileNotFoundError
        print(f❌ Datei nicht gefunden {options.zip_path}, file=sys.stderr)
        sys.exit(1)
    except zipfile.BadZipFile
        print(f❌ Ungültiges ZIP-Archiv {options.zip_path}, file=sys.stderr)
        sys.exit(1)

    filtered list[zipfile.ZipInfo] = []
    for info in infos
        if should_skip(info.filename, options.include, options.exclude)
            continue
        filtered.append(info)

    filtered.sort(key=lambda i sort_key(options.sort, i))

    results dict[str, str] = {}
    if options.workers == 1
        for info in filtered
            _, block = read_entry_task(options.zip_path, info, options)
            results[info.filename] = block
    else
        with futures.ThreadPoolExecutor(max_workers=options.workers) as ex
            futs = [ex.submit(read_entry_task, options.zip_path, info, options) for info in filtered]
            for fut in futures.as_completed(futs)
                name, block = fut.result()
                results[name] = block

    with options.output_path.open(w, encoding=utf-8, newline=options.newline) as out
        out.write(f# CodeDump für Projekt `{options.zip_path.name}`nn)
        out.write(f_Erzeugt am {datetime.now(timezone.utc).strftime('%Y-%m-%d %H%M%S UTC')}_nn)
        for info in filtered
            out.write(results[info.filename])

    print(f✅ CodeDump erstellt {options.output_path.resolve()})


# ================================ CLI =======================================

def parse_args(argv list[str]) - tuple[DumpOptions, dict, list[str]]
    ap = argparse.ArgumentParser(
        prog=codedump_from_zip,
        description=Erzeugt eine Markdown-Datei mit allen Dateien eines ZIP-Archivs.
    )
    ap.add_argument(zipfile, type=Path, help=Pfad zur ZIP-Datei.)
    ap.add_argument(output, nargs=, type=Path, default=Path(codedump.md),
                    help=Ausgabedatei (Default codedump.md))

    ap.add_argument(--include, -I, action=append, default=[],
                    help=Glob-Pattern, mehrfach möglich (z. B. '.py').)
    ap.add_argument(--exclude, -E, action=append, default=[],
                    help=Glob-Pattern zum Ausschließen (z. B. 'node_modules').)

    ap.add_argument(--preset, -P, action=append, default=[],
                    choices=sorted(PRESET_MAP.keys()),
                    help=fPreset(s) anwenden (mehrfach möglich). Verfügbar {', '.join(sorted(PRESET_MAP.keys()))})

    ap.add_argument(--max-size, type=int, default=None,
                    help=Maximale Dateigröße in Bytes; größere Dateien werden übersprungen.)
    ap.add_argument(--binaries, choices=[skip, hex, base64, bytes],
                    default=skip,
                    help=Wie mit Binärdateien verfahren werden soll (Default skip).)
    ap.add_argument(--show-metadata, action=store_true,
                    help=Datei-Metadaten im Dump anzeigen.)
    ap.add_argument(--workers, type=int, default=8,
                    help=Parallelität (Threads). 1 = seriell. Default 8.)
    ap.add_argument(--sort, choices=[path, size, time], default=path,
                    help=Sortierung der Dateien im Dump.)
    ap.add_argument(--newline, choices=[LF, CRLF], default=LF,
                    help=Zeilenende im Output.)
    ap.add_argument(--strict-text, action=store_true,
                    help=Strikte Textdecodierung bei unklarer Kodierung Datei überspringen.)

    args = ap.parse_args(argv)

    newline = n if args.newline == LF else rn

    base = DumpOptions(
        zip_path=args.zipfile,
        output_path=args.output,
        include=tuple(args.include),
        exclude=tuple(args.exclude),
        max_size=args.max_size,
        binaries=args.binaries,
        show_metadata=bool(args.show_metadata),
        workers=max(1, int(args.workers)),
        sort=args.sort,
        newline=newline,
        strict_text=bool(args.strict_text),
    )

    # Merken, was per CLI explizit gesetzt wurde (für Preset-Merging)
    cli_overrides = {
        max_size args.max_size,
        binaries args.binaries if binaries in args else None,
        show_metadata True if args.show_metadata else None,
        workers args.workers if args.workers != 8 else None,
        sort args.sort if args.sort != path else None,
        newline newline if args.newline != LF else None,
        strict_text True if args.strict_text else None,
    }

    return base, cli_overrides, list(args.preset)


def main() - None
    base, cli_overrides, presets = parse_args(sys.argv[1])
    opts = apply_presets(base, presets, cli_overrides) if presets else base
    create_codedump(opts)


if __name__ == __main__
    main()
