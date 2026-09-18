from __future__ import annotations

import os

from mangum import Mangum

from main import app

lambda_handler = Mangum(
    app,
    lifespan="off",
    api_gateway_base_path=os.getenv("API_GATEWAY_BASE_PATH", "/"),
)
