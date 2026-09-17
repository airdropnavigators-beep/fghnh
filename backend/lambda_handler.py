from __future__ import annotations

from mangum import Mangum

from main import app

lambda_handler = Mangum(app, lifespan="off")
