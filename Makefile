.PHONY: build deploy

build:
	npm run build
	touch out/.nojekyll
	cp README.md out/README.md

deploy: build
	GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_fretboard -o IdentitiesOnly=yes -o IdentityAgent=none" npx gh-pages -d out -t -r git@github.com-fretboard:GuitarLlama-Fretboard-Memorizer/GuitarLlama-Fretboard-Memorizer.github.io.git -b main
