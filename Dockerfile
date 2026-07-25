FROM python:3.12-slim

WORKDIR /app

# Dependencies first so a content-only change reuses this layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py index.html ./
COPY static ./static
# The catalogue ships inside the image: deploying data is the same push as
# deploying code, and rolling back the code rolls back the data with it.
COPY kounsly.db ./

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:80/api/health', timeout=3).status==200 else 1)"

# Port 80 on purpose: Coolify already expects the app there, so replacing nginx
# with this one needs no change on the server.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80"]
