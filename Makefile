##@ General
.PHONY: help
help: ## Display this help.
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

APP := /Applications/PR Autopilot.app
DATA := $$HOME/Library/Application Support/pr-autopilot

##@ Develop
.PHONY: deps dev test typecheck
deps: ## Install dependencies
	@pnpm install
dev: ## Run the app with HMR
	@pnpm dev
test: ## Run the vitest suite
	@pnpm test
typecheck: ## Typecheck main + renderer
	@pnpm typecheck

##@ Build & package
.PHONY: build dist clean icons
build: ## Build main/preload/renderer
	@pnpm build
dist: ## Package the macOS .app
	@pnpm dist
clean: ## Remove build outputs
	@rm -rf out dist
icons: ## Regenerate app + tray icons from build/ masters (needs magick, rsvg-convert)
	@bash scripts/make-icons.sh

##@ Install & run
.PHONY: install open skills logs
install: ## Build + package + copy app into /Applications (also applies skill edits)
	@pnpm dist && rm -rf "$(APP)" && cp -R "$$(ls -d dist/mac*/*.app | head -1)" /Applications/ && echo "installed -> $(APP) (first launch: right-click → Open)"
open: ## Open the installed app
	@open "$(APP)"
skills: ## Open the bundled skills source (plugin/) for editing
	@open ./plugin
logs: ## Tail the app log
	@tail -f "$(DATA)"/logs/*.log 2>/dev/null || echo "no logs yet"
