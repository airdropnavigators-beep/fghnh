"""Generate the fictional test documents for the evaluation set.

The PDFs are plain, text-based documents (Helvetica, selectable text) so they are
parseable both by the deterministic `MockDocumentProcessor` and by real OCR
(e.g. AWS Textract). All content is fictional demo data.

Run from the repository root:

    backend/.venv/Scripts/python.exe evaluation/generate_test_documents.py

The document text is taken from `MockDocumentProcessor.extract_text`, keeping the
generated PDFs and the mock pipeline a single source of truth.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.documents.mock_processor import MockDocumentProcessor  # noqa: E402

DEFAULT_OUT = REPO_ROOT / "evaluation" / "test_documents"

TEST_DOCUMENTS = [
    "transcript_valid.pdf",
    "transcript_gpa_conflict.pdf",
    "transcript_missing_name.pdf",
    "government_id_valid.pdf",
    "government_id_name_mismatch.pdf",
    "income_certificate_valid.pdf",
    "income_certificate_expired.pdf",
    "enrollment_verification.pdf",
    "personal_essay.pdf",
]


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(lines: list[str]) -> bytes:
    """Build a single-page PDF 1.4 with Helvetica text. Stdlib only."""
    content_lines = ["BT", "/F1 11 Tf", "14 TL", "72 720 Td"]
    for line in lines:
        content_lines.append(f"({_escape(line)}) Tj T*")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_offset = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n"
    ).encode()
    return bytes(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate fictional evaluation PDFs.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    processor = MockDocumentProcessor()
    written = 0
    for filename in TEST_DOCUMENTS:
        text = processor.extract_text(b"", filename, "application/pdf")
        pdf = build_pdf(text.rstrip("\n").split("\n"))
        (args.out / filename).write_bytes(pdf)
        written += 1
        print(f"wrote {args.out / filename} ({len(pdf)} bytes)")
    print(f"\n{written} test documents generated in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
