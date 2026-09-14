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

          # Playwright refuses to run unless the browser build it finds matches
          # the revision its npm package expects, so the two are pinned
          # together: this driver version and the @playwright/test version in
          # package.json must be bumped in the same commit.
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

          shellHook = ''
            echo "cascata dev shell: bun $(bun --version), node $(node --version)"
            echo "playwright browsers: ${pkgs.playwright-driver.version}"
          '';
        };
      });
    };
}
