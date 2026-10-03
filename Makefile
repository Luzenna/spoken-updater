# Thin wrapper; `npm test` / `npm run build` work the same on Windows without make.
.PHONY: all test build windows linux clean

all: test build

test:
	npm test

build:
	node scripts/build.mjs

windows:
	node scripts/build.mjs win-x64

linux:
	node scripts/build.mjs linux-x64

clean:
	rm -rf build dist
