# Pilot validation notes

## Combined NTA PDF detection

The extraction script was exercised against the uploaded `ugc_net_80_geography_june_2025_qp.pdf` in two small page ranges:

- PDF pages 1–3 were assigned to Paper I (General Paper).
- PDF pages 44–46 were assigned to Paper II (Geography).
- The pages 44–46 OCR sample produced both English and Hindi source-item candidates for the same numbered questions on separate PDF pages.

The sample produced five source-item candidates for pages 1–3 and eight for pages 44–46. These are extraction candidates, not final question records. Some OCR characters/options were visibly imperfect at the smoke-test DPI. The complete PDF was not extracted in this environment.

The Paper I / Paper II assignment is a page-heading heuristic. The Admin Panel intentionally requires the administrator to confirm or correct the paper assignment before generating a canonical question ID.

## Validation completed

- Python extraction and matching scripts compile.
- Repository JSON files parse successfully.
- Example question JSON passes the structural validator.
- All TypeScript/TSX files pass a TypeScript transpilation syntax scan.

## Not validated here

- Dependencies could not be installed from the npm registry in this environment, so Next.js production builds and full TypeScript type-checks were not run.
- The SQL migration has not been executed against a live Supabase project.
- Supabase Auth, RLS, Storage, OAuth, signed PDF previews, test RPCs and API flows require real project credentials and end-to-end testing.
- No official/private solved PDFs were fully imported into the application, and no questions were answer-verified or published.
