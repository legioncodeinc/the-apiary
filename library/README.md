# The Apiary Library (umbrella)

> Category: Index | Version: 1.0 | Date: July 2026 | Status: Active

The umbrella documentation library for **cross-repo / superproject-level** work in The Apiary. The Apiary is a meta-repository that aggregates independently versioned submodules (`honeycomb`, `nectar`, `doctor`, `hive`) as git submodules; each submodule owns its own `library/` for product work scoped to that repo.

This umbrella library holds only work that genuinely spans repos or belongs to the superproject itself: the combined release train and "hive release manifest", the one-line installer and its product-loading/configuration model, cross-cutting install-time telemetry, and the ADRs that bind the submodules together at the fleet level.

## Layout

```
library/
  requirements/
    backlog/       umbrella PRDs not yet started
    in-work/       umbrella PRDs under active work
    completed/     shipped umbrella PRDs
  knowledge/
    public/        end-user / operator facing docs
    private/
      architecture/  ADRs for cross-repo / superproject decisions
```

## Conventions

- PRDs: `requirements/<lifecycle>/prd-<###>-<slug>/prd-<###>-<slug>-index.md` (+ sub-PRDs `prd-<###><a|b|c>-...md`), repo-local sequential numbering.
- ADRs: `knowledge/private/architecture/ADR-<NNNN>-<slug>.md`, Nygard format, repo-local sequential numbering.
- Move a PRD's whole folder between lifecycle folders when its status changes; the folder location is the lifecycle source of truth.

**Related:**
- Submodule libraries: `honeycomb/library/`, `nectar/library/`, `doctor/library/`, `hive/library/`.
