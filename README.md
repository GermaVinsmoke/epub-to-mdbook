# epub-to-mdbook

Convert an EPUB book into an [mdBook](https://github.com/rust-lang/mdBook) project.

## Features

- Converts EPUB chapters using the EPUB TOC
- Generates `book.toml` and `src/SUMMARY.md`
- Copies images and CSS into `src/assets`
- Rewrites internal links for mdBook
- Preserves code blocks as fenced Markdown
- Outputs to `<epub-file-name>_mdbook` by default

## Requirements

- Node.js 18+
- `mdbook` installed if you want to build or serve the generated output

## Install

### From npm

```bash
npm install -g epub-to-mdbook
```

## Usage

```bash
epub-to-mdbook --epub <book.epub> [--out <dir>]
```

## Options

- `--epub <path>`: path to the source EPUB file
- `--out <dir>`: custom output directory
- `-h, --help`: show usage

## Examples

### Default output directory

```bash
epub-to-mdbook --epub ./My_Book.epub
```

Output:

```bash
my-book_mdbook
```

### Custom output directory

```bash
epub-to-mdbook --epub ./book.epub --out ./my-book-mdbook
```

## Build and serve the generated book

```bash
cd <output-dir>
mdbook build
mdbook serve
```

## Local CLI testing

Link the package globally:

```bash
pnpm install
pnpm run link:global
```

Then test it from anywhere:

```bash
epub-to-mdbook --epub ./The_Go_Programming_Language-Brian-W_Kernighan-2015.epub --out ./my-mdbook
```

## Development scripts

```bash
pnpm run regenerate
pnpm run mdbook:serve
pnpm run build
pnpm run build:dry
pnpm run publish:npm
```

### What they do

- `regenerate`: clear and regenerate sample output
- `mdbook:serve`: serve the sample generated book locally
- `build`: package the CLI into an npm tarball
- `build:dry`: verify publish contents without publishing
- `publish:npm`: publish the package to npm

## Publish to npm

Dry run first:

```bash
pnpm run build:dry
```

Publish:

```bash
pnpm run publish:npm
```

## License

MIT
