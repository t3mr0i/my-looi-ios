ARG HERMES_BASE_IMAGE=nousresearch/hermes-agent:v0.22.5@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d
FROM ${HERMES_BASE_IMAGE}

USER root
WORKDIR /app
# The official image's runtime venv is sealed and /opt/data is a Fly volume.
# Build a small Hermes-core + DDGS environment from the image's committed
# pyproject/uv.lock so DDGS (pinned there to 9.16.0) is available to both the
# API process and Hermes' isolated search subprocess after the volume mounts.
RUN python3 -m pm.build_env --source /opt/hermes --python /usr/local/bin/python3 \
      --cache /opt/hermes/uv-cache \
      --out /opt/hermes/looi-agent-venv --no-install-project --sealed --extra ddgs \
    && /opt/hermes/looi-agent-venv/bin/python -c 'import ddgs; assert callable(ddgs.DDGS)'
COPY --chown=10000:10000 services/hermes /app/services/hermes
COPY --chown=0:0 services/hermes/entrypoint.sh /usr/local/bin/looi-hermes-entrypoint
RUN chmod 0755 /usr/local/bin/looi-hermes-entrypoint && chown -R 10000:10000 /app/services

ENV PYTHONPATH="/app:/opt/hermes"
ENV HERMES_PYTHON="/opt/hermes/looi-agent-venv/bin/python"
ENV PORT=8080
EXPOSE 8080

# The vendor entrypoint performs unrelated Hermes bootstrap/seeding before
# starting its own runtime. LOOI initializes only its service data directory,
# then drops privileges and runs the library API directly.
USER root
ENTRYPOINT ["/usr/local/bin/looi-hermes-entrypoint"]
CMD ["/opt/hermes/looi-agent-venv/bin/python", "-m", "services.hermes.server"]
