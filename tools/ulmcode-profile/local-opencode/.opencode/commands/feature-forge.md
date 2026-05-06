---
description: Run the full Feature Forge workflow with category-based OMO routing.
agent: sisyphus
model: openai/gpt-5.5-fast
---

Run Feature Forge using category-based OMO delegation only.

Do not invoke custom markdown agents directly.

Workflow:
1. task(category="repo-scout") to map the codebase.
2. task(category="product-ideator") to generate grounded ideas.
3. task(category="product-taste-pass") for semantic/product/copy sanity before Kimi.
4. optional task(category="human-taste-review") only if user-facing human feel matters.
5. task(category="frontend-taste") for UI/UX spec.
6. task(category="backend-architect") for backend/data/API/auth design.
7. task(category="frontend-builder") and task(category="backend-builder") for implementation.
8. task(category="verification-court") for final technical review.
9. optional xhigh-court only for high-risk failures.

User request:
$ARGUMENTS
