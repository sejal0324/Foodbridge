# FoodBridge AI: AI Service

Stateless Python 3.12 + FastAPI service: surplus forecasting (scikit-learn), explainable weighted matching,
allocation optimisation and vehicle routing (OR-Tools), single-step LLM inference (Gemini/OpenAI adapters) and
data-driven insights. It has **no database access** and makes **no business decisions**: the backend sends all
inputs and remains authoritative. Every endpoint except `GET /ai/health` requires
`Authorization: Bearer $INTERNAL_SERVICE_TOKEN`.

```
app/        main.py · core/ (config, security, errors, logging) · api/ (routers) · services/ · schemas/ · models/artifacts/
training/   generate_dataset.py (synthetic, deterministic) · train.py · evaluation.py
datasets/   synthetic_restaurant_metrics.csv (every row labelled SYNTHETIC) + README
tests/      pytest suite (no real external calls)
```

```bash
# from ai-service/ (or use the root scripts: npm run dev:ai / npm run test:ai)
~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --port 8001
.venv/bin/python -m pytest -q && .venv/bin/ruff check .
.venv/bin/python -m training.generate_dataset && .venv/bin/python -m training.train   # reproducible retraining
```

Docs: [AI_ARCHITECTURE.md](../docs/AI_ARCHITECTURE.md) · [AI_MODEL_EVALUATION.md](../docs/AI_MODEL_EVALUATION.md) ·
[MATCHING_ALGORITHM.md](../docs/MATCHING_ALGORITHM.md). Docker: `deployment/docker/ai-service.Dockerfile`.
