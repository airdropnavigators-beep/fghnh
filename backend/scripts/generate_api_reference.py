"""Generate the API reference from the live FastAPI OpenAPI schema.

Usage (from the repository root)::

    backend/.venv/Scripts/python.exe backend/scripts/generate_api_reference.py

Writes ``docs/openapi.json`` and ``docs/api-reference.md``. The generated files are
committed so the docs are reviewable; re-run this script whenever routes or models
change so the reference can never drift from the code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
DOCS_DIR = REPO_ROOT / "docs"

sys.path.insert(0, str(BACKEND_ROOT))

HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def _schema_type(schema: dict[str, Any]) -> str:
    """Human-readable type for a JSON-schema fragment."""
    if "$ref" in schema:
        return f"`{schema['$ref'].split('/')[-1]}`"
    if "anyOf" in schema:
        return " \\| ".join(_schema_type(s) for s in schema["anyOf"])
    if "enum" in schema:
        return " | ".join(f"`{v}`" for v in schema["enum"])
    if "allOf" in schema and len(schema["allOf"]) == 1:
        return _schema_type(schema["allOf"][0])
    if schema.get("format") == "binary":
        return "file (binary)"
    kind = schema.get("type", "any")
    if kind == "array":
        return f"array<{_schema_type(schema.get('items', {}))}>"
    return kind


def _table_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def _properties_table(schema: dict[str, Any], spec: dict[str, Any]) -> list[str]:
    if "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        schema = spec.get("components", {}).get("schemas", {}).get(name, {})
    props = schema.get("properties", {})
    if not props:
        return []
    required = set(schema.get("required", []))
    lines = [
        "",
        _table_row(["Field", "Type", "Required", "Description"]),
        _table_row(["---", "---", "---", "---"]),
    ]
    for field, meta in props.items():
        description = (meta.get("description") or "").replace("|", "\\|").replace("\n", " ")
        lines.append(
            _table_row(
                [
                    f"`{field}`",
                    _schema_type(meta),
                    "yes" if field in required else "no",
                    description,
                ]
            )
        )
    return lines


def _render_operation(method: str, path: str, op: dict[str, Any], spec: dict[str, Any]) -> list[str]:
    lines = [f"### `{method.upper()} {path}`", ""]
    if op.get("summary"):
        lines.append(f"**{op['summary']}**")
        lines.append("")
    if op.get("description"):
        lines.append(op["description"].strip())
        lines.append("")

    params = op.get("parameters", [])
    if params:
        lines.append("**Parameters**")
        lines.append("")
        lines.append(_table_row(["Name", "In", "Required", "Type"]))
        lines.append(_table_row(["---", "---", "---", "---"]))
        for param in params:
            lines.append(
                _table_row(
                    [
                        f"`{param['name']}`",
                        param.get("in", ""),
                        "yes" if param.get("required") else "no",
                        _schema_type(param.get("schema", {})),
                    ]
                )
            )
        lines.append("")

    body = op.get("requestBody")
    if body:
        content = body.get("content", {})
        media_type = next(iter(content), "application/json")
        schema = content.get(media_type, {}).get("schema", {})
        lines.append(f"**Request body** (`{media_type}`)")
        lines.extend(_properties_table(schema, spec))
        lines.append("")

    lines.append("**Responses**")
    lines.append("")
    lines.append(_table_row(["Status", "Description", "Body"]))
    lines.append(_table_row(["---", "---", "---"]))
    for status, response in sorted(op.get("responses", {}).items()):
        content = response.get("content", {})
        body_schema = content.get("application/json", {}).get("schema", {})
        body_type = _schema_type(body_schema) if body_schema else "—"
        description = (response.get("description") or "").replace("|", "\\|")
        lines.append(_table_row([f"`{status}`", description, body_type]))
    lines.append("")
    return lines


def render_markdown(spec: dict[str, Any]) -> str:
    info = spec.get("info", {})
    lines = [
        f"# {info.get('title', 'API')} Reference",
        "",
        "> Generated from the live OpenAPI schema by "
        "`backend/scripts/generate_api_reference.py`. Do not edit by hand.",
        "",
        info.get("description", "").strip(),
        "",
        f"**Version:** `{info.get('version', '')}`",
        "",
        "## Endpoints",
        "",
        _table_row(["Method", "Path", "Summary", "Operation"]),
        _table_row(["---", "---", "---", "---"]),
    ]
    for path, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            if method not in HTTP_METHODS:
                continue
            anchor = f"{method}-{path}".replace("/", "").replace("{", "").replace("}", "").lower()
            lines.append(
                _table_row(
                    [
                        f"`{method.upper()}`",
                        f"`{path}`",
                        (op.get("summary") or "").replace("|", "\\|"),
                        f"[details](#{anchor})",
                    ]
                )
            )
    lines.append("")

    for path, ops in spec.get("paths", {}).items():
        for method, op in ops.items():
            if method not in HTTP_METHODS:
                continue
            lines.extend(_render_operation(method, path, op, spec))

    schemas = spec.get("components", {}).get("schemas", {})
    if schemas:
        lines.extend(["## Schemas", ""])
        for name, schema in schemas.items():
            lines.append(f"### `{name}`")
            lines.extend(_properties_table(schema, spec))
            if schema.get("enum"):
                lines.append("")
                lines.append("Values: " + ", ".join(f"`{v}`" for v in schema["enum"]))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    from main import app  # imported after sys.path is configured

    spec = app.openapi()
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    openapi_path = DOCS_DIR / "openapi.json"
    openapi_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")

    reference_path = DOCS_DIR / "api-reference.md"
    reference_path.write_text(render_markdown(spec), encoding="utf-8")

    print(f"wrote {openapi_path.relative_to(REPO_ROOT)}")
    print(f"wrote {reference_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
