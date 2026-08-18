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
          shellHook = ''
            echo "cascata dev shell: bun $(bun --version), node $(node --version)"
          '';
        };
      });
    };
}
