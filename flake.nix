{
  description = "Cascata - real-time waterfall spectrogram for vocal training";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.bun pkgs.nodejs_24 ];

          # Browsers come from `bun run browser:install`, not from the store.
          # nixpkgs' webkit is broken on Linux -- its pw_run.sh cannot find the
          # browser binary (NixOS/nixpkgs#507112) -- so "browsers from the
          # flake" could only ever have been true on darwin, and one supplier
          # everywhere beats a promise that holds on half the platforms. The
          # revision is pinned either way: the exact @playwright/test version
          # in package.json decides it.
          #
          # Playwright's own dependency check has to be off, though: it shells
          # out to ldd, which inside this shell resolves against Nix's glibc and
          # so reports every system library as missing -- libglib, libcairo,
          # libexpat, all of them present. scripts/check-browser.ts replaces it
          # by launching the browser for real, which cannot produce that kind of
          # false negative.
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

          shellHook = ''
            echo "cascata dev shell: bun $(bun --version), node $(node --version)"
          '';
        };
      });
    };
}
