
import { Preset, SecurityLimits } from './types';

export const DEFAULT_EXCLUDES: string[] = [
    "**/.git/**", "**/.github/**", "**/.gitlab/**",
    "**/.idea/**", "**/.vscode/**",
    "**/__pycache__/**", "**/.mypy_cache/**", "**/.pytest_cache/**", "**/.ruff_cache/**",
    "**/.cache/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/.parcel-cache/**",
    "**/.next/**", "**/.nuxt/**", "**/coverage/**", "**/site/**",
    "**/target/**", "**/bin/**", "**/obj/**",
    "**/.venv/**", "**/venv/**", "**/env/**",
];



export const LLM_CODE_REVIEW_INCLUDES: string[] = [
    // Source code across major ecosystems
    "**/*.py", "**/*.pyi", "**/*.ipynb",
    "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.cjs",
    "**/*.java", "**/*.kt", "**/*.kts", "**/*.scala", "**/*.groovy",
    "**/*.cs", "**/*.fs", "**/*.vb",
    "**/*.go", "**/*.rs", "**/*.zig",
    "**/*.c", "**/*.h", "**/*.cpp", "**/*.cc", "**/*.cxx", "**/*.hpp", "**/*.hh", "**/*.m", "**/*.mm",
    "**/*.swift", "**/*.php", "**/*.rb", "**/*.r", "**/*.R", "**/*.lua", "**/*.pl", "**/*.pm",
    "**/*.ex", "**/*.exs", "**/*.erl", "**/*.hrl", "**/*.clj", "**/*.cljs", "**/*.hs", "**/*.ml", "**/*.mli",
    "**/*.dart", "**/*.vue", "**/*.svelte", "**/*.astro",
    "**/*.sql", "**/*.graphql", "**/*.gql", "**/*.proto",
    // App, build and deployment configuration that changes behavior
    "**/*.json", "**/*.jsonc", "**/*.yaml", "**/*.yml", "**/*.toml", "**/*.ini", "**/*.cfg", "**/*.conf", "**/*.properties",
    "**/*.xml", "**/*.gradle", "**/*.gradle.kts", "**/*.sbt",
    "**/Dockerfile", "**/Dockerfile.*", "**/docker-compose*.yml", "**/docker-compose*.yaml",
    "**/Makefile", "**/CMakeLists.txt", "**/*.cmake",
    "**/package.json", "**/pyproject.toml", "**/requirements*.txt", "**/Pipfile", "**/poetry.lock",
    "**/Cargo.toml", "**/go.mod", "**/go.sum", "**/pom.xml", "**/build.gradle", "**/settings.gradle",
    "**/*.csproj", "**/*.fsproj", "**/*.vbproj", "**/*.sln",
    "**/Gemfile", "**/composer.json", "**/mix.exs", "**/pubspec.yaml",
    // Human documentation and tests that help a reviewer understand intent
    "**/*.md", "**/*.mdx", "**/*.rst", "**/*.txt",
    "**/tests/**", "**/test/**", "**/__tests__/**", "**/spec/**", "**/e2e/**",
    // Web assets that are often hand-written and semantically relevant
    "**/*.html", "**/*.css", "**/*.scss", "**/*.sass", "**/*.less",
];

export const LLM_CODE_REVIEW_EXCLUDES: string[] = [
    ...DEFAULT_EXCLUDES,
    // Dependency and package-manager noise
    "**/package-lock.json", "**/npm-shrinkwrap.json", "**/yarn.lock", "**/pnpm-lock.yaml",
    "**/Cargo.lock", "**/Gemfile.lock", "**/composer.lock", "**/Pipfile.lock", "**/poetry.lock",
    "**/go.sum",
    // Generated artifacts, reports, caches and framework output
    "**/reports/**", "**/report/**", "**/data/**", "**/datasets/**", "**/fixtures/large/**",
    "**/assets/generated/**", "**/generated/**", "**/gen/**", "**/.generated/**",
    "**/vendor/**", "**/vendors/**", "**/third_party/**", "**/external/**",
    "**/storybook-static/**", "**/.storybook-static/**", "**/.turbo/**", "**/.vite/**",
    "**/release/**", "**/releases/**", "**/out/**", "**/tmp/**", "**/temp/**",
    "**/.gradle/**", "**/.terraform/**", "**/.serverless/**",
    // Minified/bundled outputs and maps
    "**/*.min.js", "**/*.min.css", "**/*.bundle.js", "**/*.bundle.css", "**/*.map",
    // Binary/media/office/archive/model formats that are rarely useful in code review
    "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.webp", "**/*.ico", "**/*.svgz",
    "**/*.pdf", "**/*.zip", "**/*.tar", "**/*.gz", "**/*.7z", "**/*.rar",
    "**/*.mp3", "**/*.mp4", "**/*.mov", "**/*.avi", "**/*.wav",
    "**/*.woff", "**/*.woff2", "**/*.ttf", "**/*.otf",
    "**/*.sqlite", "**/*.sqlite3", "**/*.db", "**/*.parquet", "**/*.feather",
    "**/*.onnx", "**/*.pt", "**/*.pth", "**/*.bin",
    // Secrets/local machine state. Secret scanner still protects included files.
    "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/id_rsa", "**/id_ed25519",
];


export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
    maxTotalUncompressedBytes: 500 * 1024 * 1024,
    maxCompressionRatio: 1000,
    maxFileCount: 25000,
    maxPathLength: 512,
    maxPatternLength: 100,
    workerStallTimeoutMs: 30000,
    maxSingleFileInflationRatio: 20,
    maxPromptInjectionFindings: 25,
    maxScanLineLength: 10000,
    maxBase64DecodeBytes: 262144,
    maxCustomRules: 100,
    maxCustomRulePatternLength: 500,
};

export const DEFAULT_MODEL_PRICING_INPUT_PER_MILLION = 5;

export const PRESETS: Preset[] = [
    {
        name: "llm-code-review",
        options: {
            include: LLM_CODE_REVIEW_INCLUDES,
            exclude: LLM_CODE_REVIEW_EXCLUDES,
            maxSize: 750000,
            binaryMode: "skip",
            showMetadata: true,
            sort: "path",
            outputFormat: "markdown",
            includeRepoMap: true,
            useGitignore: true,
            useDockerignore: true,
            secretScanning: true,
            condenseCode: false,
            astCondensationMode: "comments",
            llmCodeReviewMode: true,
            promptInjectionScanning: true,
            entropySecretScanning: true,
            semanticChunking: true,
        },
    },
    {
        name: "full-stack",
        options: {
            include: ["**/*"],
            exclude: [
                ...DEFAULT_EXCLUDES,
                "**/*.lock", "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml",
            ],
            maxSize: 2000000,
            binaryMode: "skip",
            showMetadata: true,
            sort: "path",
            outputFormat: "markdown",
        },
    },
    {
        name: "python-web",
        options: {
            include: ["**/*.py", "**/*.toml", "**/*.ini", "**/*.cfg", "**/*.conf", "**/*.md", "**/*.txt", "**/*.json", "**/*.yaml", "**/*.yml", "**/templates/**/*.html", "**/static/**/*"],
            exclude: ["**/.venv/**", "**/venv/**", "**/env/**", "**/__pycache__/**", "**/.mypy_cache/**", "**/.pytest_cache/**", "**/dist/**", "**/build/**", "**/.cache/**"],
            maxSize: 1000000,
            binaryMode: "skip",
        },
    },
    {
        name: "react",
        options: {
            include: ["**/*.tsx", "**/*.ts", "**/*.jsx", "**/*.js", "**/*.css", "**/*.scss", "**/*.html", "**/*.json", "**/*.md", "**/*.yaml", "**/*.yml", "public/**/*"],
            exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.parcel-cache/**", "**/.next/**", "**/.nuxt/**", "**/coverage/**"],
            maxSize: 800000,
            binaryMode: "skip",
        },
    },
    {
        name: "node-app",
        options: {
            include: ["**/*.js", "**/*.cjs", "**/*.mjs", "**/*.ts", "**/*.json", "**/*.md", "**/*.yaml", "**/*.yml", "**/*.env*", "**/.env*"],
            exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.parcel-cache/**", "**/.next/**", "**/.nuxt/**", "**/coverage/**", "**/*.lock", "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml"],
            maxSize: 1000000,
            binaryMode: "skip",
        },
    },
    {
        name: "data-science",
        options: {
            include: ["**/*.py", "**/*.ipynb", "**/*.md", "**/*.txt", "**/*.csv", "**/*.json", "**/*.yaml", "**/*.yml", "**/*.toml"],
            exclude: ["**/.venv/**", "**/__pycache__/**", "**/.ipynb_checkpoints/**", "**/wandb/**", "**/mlruns/**", "**/data/**", "**/datasets/**", "**/dist/**", "**/build/**"],
            maxSize: 1500000,
            binaryMode: "skip",
        },
    },
    {
        name: "rust-crate",
        options: {
            include: ["**/*.rs", "Cargo.toml", "Cargo.lock", "**/*.md", "**/*.yaml", "**/*.yml"],
            exclude: ["**/target/**", "**/dist/**"],
            maxSize: 800000,
        },
    },
    {
        name: "java-maven",
        options: {
            include: ["**/*.java", "pom.xml", "**/*.md", "**/*.yaml", "**/*.yml", "**/*.xml", "**/*.properties"],
            exclude: ["**/target/**", "**/out/**", "**/.idea/**"],
            maxSize: 1000000,
        },
    },
    {
        name: "dotnet",
        options: {
            include: ["**/*.cs", "**/*.csproj", "**/*.sln", "**/*.json", "**/*.md", "**/*.yaml", "**/*.yml"],
            exclude: ["**/bin/**", "**/obj/**"],
            maxSize: 1000000,
        },
    }
];
