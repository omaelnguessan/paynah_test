# ---------------------------------------------------------------------------
# paynad — mini payment platform
# A fresh clone only needs:  make up && make migrate && make seed
# ---------------------------------------------------------------------------
SHELL := /bin/bash
COMPOSE := docker compose
SERVICES := accounts transactions payments

# Load .env so the Makefile can echo the ports it actually exposes.
ifneq (,$(wildcard .env))
include .env
export
endif

.DEFAULT_GOAL := help
.PHONY: help env install up down restart logs ps build rebuild migrate migration-revert seed test test-cov test-e2e test\:e2e test\:e2e-isolated test-stack-down lint clean swagger shell psql

help: ## Show this help
	@grep -hE '^[a-zA-Z_\\:-]+:.*?## ' $(MAKEFILE_LIST) \
	  | sed 's/\\//' \
	  | awk 'BEGIN {FS = ":[^:]*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example when missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example")

install: ## Install workspace dependencies on the host (for IDE and local tests)
	pnpm install

up: env ## Build if needed and start the whole stack, waiting for health
	# --renew-anon-volumes: the dev containers shield node_modules behind an
	# anonymous volume, which would otherwise keep an image's old dependencies
	# alive after a package.json change.
	$(COMPOSE) up -d --build --wait --renew-anon-volumes
	@$(MAKE) --no-print-directory swagger

down: ## Stop the stack, keeping the data volumes
	$(COMPOSE) down --remove-orphans

restart: down up ## Full stop then start

ps: ## Show container state and health
	$(COMPOSE) ps

logs: ## Follow logs (make logs SERVICE=payments to narrow)
	$(COMPOSE) logs -f --tail=100 $(SERVICE)

build: ## Build the three images without starting them
	$(COMPOSE) build

rebuild: ## Rebuild the images from scratch, ignoring the layer cache
	$(COMPOSE) build --no-cache

migrate: ## Run pending TypeORM migrations in every service
	@for s in $(SERVICES); do \
	  echo "==> migrating $$s"; \
	  $(COMPOSE) exec -T $$s sh -lc 'cd /app/services/'"$$s"' && pnpm typeorm migration:run' || exit 1; \
	done

migration-revert: ## Revert the last migration of one service (make migration-revert SERVICE=accounts)
	@test -n "$(SERVICE)" || (echo "SERVICE=<accounts|transactions|payments> is required" && exit 1)
	$(COMPOSE) exec -T $(SERVICE) sh -lc 'cd /app/services/$(SERVICE) && pnpm typeorm migration:revert'

seed: ## Load development fixtures into every service
	@for s in $(SERVICES); do \
	  echo "==> seeding $$s"; \
	  $(COMPOSE) exec -T $$s sh -lc 'cd /app/services/'"$$s"' && pnpm seed' || exit 1; \
	done

test: ## Run unit tests across the workspace
	pnpm -r test

test\:e2e: ## Run end-to-end tests inside the running containers
	@docker compose ps --status running --services | grep -q accounts \
	  || (echo "the stack must be running: make up && make migrate" && exit 1)
	@for s in $(SERVICES); do \
	  echo "==> e2e $$s"; \
	  $(COMPOSE) exec -T $$s sh -lc 'cd /app/services/'"$$s"' && pnpm test:e2e' || exit 1; \
	done

test-e2e: test\:e2e ## Alias for `make test:e2e`

# --- the isolated end-to-end stack -----------------------------------------
# Ephemeral databases in tmpfs, no published ports, its own compose project:
# it runs next to `make up` and in CI without touching either.
# -p is explicit: .env exports COMPOSE_PROJECT_NAME, which would otherwise pull
# this stack into the development project and delete its containers on teardown.
COMPOSE_TEST := docker compose -p paynad-test -f docker-compose.test.yml

test\:e2e-isolated: ## Run the e2e suites against a throwaway stack, then delete it
	@set -e; \
	trap '$(COMPOSE_TEST) down --volumes --remove-orphans' EXIT; \
	$(COMPOSE_TEST) up -d --build --wait; \
	for s in $(SERVICES); do \
	  echo "==> migrating $$s"; \
	  $(COMPOSE_TEST) exec -T $$s sh -lc 'cd /app/services/'"$$s"' && pnpm typeorm migration:run'; \
	done; \
	for s in $(SERVICES); do \
	  echo "==> e2e $$s"; \
	  $(COMPOSE_TEST) exec -T $$s sh -lc 'cd /app/services/'"$$s"' && pnpm test:e2e'; \
	done

test-stack-down: ## Delete the isolated test stack if a run left it behind
	$(COMPOSE_TEST) down --volumes --remove-orphans

test-cov: ## Unit tests with coverage (payments enforces its domain/application floor)
	pnpm -r test:cov

lint: ## Lint the workspace
	pnpm -r lint

shell: ## Open a shell in a service container (make shell SERVICE=payments)
	@test -n "$(SERVICE)" || (echo "SERVICE=<accounts|transactions|payments> is required" && exit 1)
	$(COMPOSE) exec $(SERVICE) sh

psql: ## Open psql on a service database (make psql SERVICE=accounts)
	@test -n "$(SERVICE)" || (echo "SERVICE=<accounts|transactions|payments> is required" && exit 1)
	$(COMPOSE) exec pg-$(SERVICE) sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

clean: ## Stop everything and delete volumes, images and local build output
	$(COMPOSE) down --volumes --remove-orphans --rmi local
	rm -rf packages/*/dist services/*/dist packages/*/coverage services/*/coverage

swagger: ## Print the OpenAPI URLs
	@echo ""
	@echo "  Swagger UI"
	@echo "    accounts      http://localhost:$(ACCOUNTS_PORT)/docs"
	@echo "    transactions  http://localhost:$(TRANSACTIONS_PORT)/docs"
	@echo "    payments      http://localhost:$(PAYMENTS_PORT)/docs"
	@echo "  RabbitMQ UI     http://localhost:$(RABBITMQ_MANAGEMENT_PORT)  ($(RABBITMQ_USER))"
	@echo ""
