FROM python:3.12-slim

WORKDIR /app

# Dependencies first so a content-only change reuses this layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py index.html ./
COPY static ./static

# The catalogue is NOT in the image any more. It used to be, and that was the
# better arrangement while it fitted: deploying data was the same push as
# deploying code, and rolling back the code rolled back the data with it.
#
# It stopped fitting. Five countries make the file 78 MB, GitHub refuses a blob
# over 100 MB, and every deploy was pushing the whole catalogue through git and
# leaving another copy of it in an image on a 20 GB disk.
#
# It now lives on the host at /data/kounsly and is mounted read-only, with
# KOUNSLY_DB pointing at it. The pipeline puts it there with
# `build_db.py --publish-remote`. A container that starts without that mount
# fails its health check rather than serving an empty catalogue.

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:80/api/health', timeout=3).status==200 else 1)"

# Port 80 on purpose: Coolify already expects the app there, so replacing nginx
# with this one needs no change on the server.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80"]
