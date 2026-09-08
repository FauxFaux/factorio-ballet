// <docs/popular-ids.txt awk '{ print $NF }' | grep .... | sed 's/$/-/' | tr -d '\n' | tail -c 4096 | fold -w 80 | sed "s/.*/'&' +/"
export const COMMON_IDS =
  '-electrolyzer-cocoon-carbide-nitrate-refsyngas-mechanical-boiling-control-yumako' +
  '-critical-worker-gasoline-signal-sintered-facility-soot-parts-arthropod-disposal' +
  '-transmutation-night-chitin-petgas-silica-thruster-vision-repair-derrick-butcher' +
  'y-wind-brass-vitamelange-nitric-guide-antenna-render-turd-reef-lubricant-imersiu' +
  'm-biomethanol-lime-insight-spidertron-beam-lifesupport-manganese-monoxide-scrubb' +
  'er-diet-white-powdered-card-loader-stack-antelope-pylon-stainless-bauxite-nano-l' +
  'ong-simulation-express-tailings-boil-volcanic-wall-clay-tech-capacity-enclosure-' +
  'projectile-bullet-xenogenic-storehouse-accumulator-kimberlite-bearing-stripped-s' +
  'olvent-assembling-seedling-yield-quantum-factory-coalbed-niobium-aromatics-plasm' +
  'a-slime-glycerol-radar-geothermal-wetland-nutrients-drilling-chrome-dryland-crid' +
  'ren-biological-astronomic-board-recharge-miner-railgun-reprocessing-observation-' +
  'sulfate-refugium-phosphate-weapons-production-closed-purple-manure-open-butane-m' +
  'k05-stream-petroleum-culture-substation-powerplant-metal-ammonium-slag-electroly' +
  'sis-separator-moss-robots-rubber-particle-rejects-calcium-shard-chemistry-resin-' +
  'arcosphere-saline-rich-strongbox-passive-wheel-bitumen-5000-active-organic-ammon' +
  'ia-shotgun-fertilizer-splinter-pollution-explosives-garden-sulfuric-tower-overfl' +
  'ow-liquefaction-requester-laboratory-sheet-helium-burner-rail-imersite-dormant-c' +
  'lean-substrate-asteroid-textplate-collector-locomotive-black-filtering-print-ben' +
  'zene-solder-explosive-cooling-oxygen-fines-coil-liquor-fission-grassland-legacy-' +
  'casein-seaweed-cable-synthesis-gear-ammo-tool-iridium-chlorine-exchanger-deuteri' +
  'um-superior-thorium-sorting-plutonium-huge-arboretum-compile-platinum-brick-lime' +
  'stone-diamond-sulfide-soil-chromium-valve-filtration-circuit-naquium-bacteria-bi' +
  'oreserve-vulcanite-brown-tholin-4000-geode-propene-spaceship-buffer-land-berylli' +
  'um-probe-breeding-crusher-remote-crude-mirror-pressure-extract-dirty-efficiency-' +
  'hydroxide-yellow-washing-fast-chunk-damage-electronics-cryonite-armor-material-m' +
  'agazine-plantation-compressed-thermal-frame-ethylene-basic-splitter-dioxide-hota' +
  'ir-bone-enriched-algae-warehouse-refinery-aluminum-methanol-catalyst-rifle-spong' +
  'e-spore-purified-holmium-defense-research-transport-mineral-cellulose-3000-drone' +
  '-generator-refining-skin-ground-rare-slurry-full-sulfur-pure-alloy-antimatter-li' +
  'ght-pellet-engine-extraction-large-coolant-shield-fragment-quartz-processor-arti' +
  'fact-roll-oven-reheat-plastic-naphtha-wagon-cargo-pole-silicon-cobalt-sludge-tun' +
  'gsten-earth-medium-provider-construction-zungror-lithium-mine-fiber-boiler-nucle' +
  'ar-separation-extractor-xyhiphoe-silo-catalogue-neutron-cool-navens-distillate-d' +
  'ust-unit-green-gold-numal-deep-xeno-scrondrix-machine-natural-biter-filter-guts-' +
  'turret-bhoddos-syngas-aluminium-purex-blue-nitrogen-underground-high-mixture-wir' +
  'e-artillery-chromite-drill-vonix-moondrop-refined-mova-upgrade-furnace-fawogae-k' +
  'mauts-waste-silver-yaedols-trits-fusion-puffer-blood-guar-stone-pump-concentrate' +
  '-vrauks-glass-dhilmos-brain-pressured-meat-beacon-methane-heat-korlex-productivi' +
  'ty-oxide-breeder-chest-processed-salt-panel-temperate-nexelit-storage-lead-cadav' +
  'eric-dingrits-personal-phagnot-checkpoint-crushed-mixture1-logistic-power-tank-f' +
  'ruit-arthurian-cottongut-used-plant-phadai-swamp-sand-fill-residual-speed-heavy-' +
  'rock-chloride-core-vehicle-uranium-zipir-satellite-turbine-sodium-shell-mukmoux-' +
  'carbon-wood-inserter-titanium-roboport-simik-arqad-laser-concrete-solution-2000-' +
  'electric-battery-powder-dingrit-alien-sample-ulric-desert-nickel-outlet-ingot-fr' +
  'om-auog-tuuphra-package-hydrogen-solar-zinc-coke-grade-energy-belt-arum-seeds-ca' +
  'psule-kicalk-small-reactor-casting-advanced-cell-grod-1000-matter-seed-pipe-mini' +
  'ng-ralesia-improved-codex-cracking-robot-rennea-science-burn-coal-fish-crystal-p' +
  'late-food-rocket-chemical-smelting-steel-combustion-acid-data-copper-yotoi-solid' +
  '-unbox-fuel-canister-delivery-tree-mega-iron-cannon-molten-caged-launch-boxed-fa' +
  'rm-module-pack-void-processing-equipment-pulp-mk01-space-liquid-recycling-fluid-' +
  'biomass-super-empty-mk04-mk03-technology-mk02-crush-steam-barrel-water-angels-nu' +
  'llius-pyvoid-';

/**
 * A frozen example of what a full-ish plan looks like once packed, used as the deflate dictionary:
 * a hash is a few hundred
 * bytes, far too short for deflate to learn the key names from the payload itself, so it is handed
 * them.
 *
 * Keep this literal unchanged when `UrlState` gains or loses fields: changing the dictionary makes
 * existing hashes impossible to inflate. It is intentionally typed only as a generic record so
 * TypeScript does not force it to track the current state schema. What earns its place here is the
 * punctuation around the numbers (`{"recipe":`, `,"machine":`, `"entries":[`), and deriving it
 * from real data would tie the dictionary to the dataset those recipes came from. The numbers below
 * are real indices all the same, so that their widths are representative.
 */
export const REFERENCE_STATE: Record<string, unknown> = {
  v: 1,
  rs: 'silicon',
  cs: 'makes:item:copper-plate',
  gp: 69,
  cl: [
    {
      entries: [
        {
          recipe: 320,
          count: 25,
        },
        {
          recipe: 1451,
          productivityModules: 2,
        },
        {
          recipe: 1452,
          productivityModules: 4,
          speedModules: 8,
        },
        {
          recipe: 45,
        },
        {
          recipe: 247,
        },
        {
          recipe: 1463,
          machine: 108,
        },
        {
          recipe: 1461,
        },
        {
          recipe: 249,
          modules: [
            [2, 1],
            [5, 3],
          ],
        },
        {
          recipe: 248,
        },
        {
          recipe: 1460,
          count: 4,
        },
        {
          recipe: 1114,
          machine: 65,
        },
        {
          recipe: 1115,
          machine: 67,
        },
        {
          recipe: 2207,
        },
      ],
    },
    {
      entries: [],
      imports: [],
      exports: [],
      design: {
        columns: [
          {
            entities: [
              [0, 8, 4, 3, 3, 45],
              [1, 7, 5, 'e'],
              [2, 4, 5, 1, 0],
              [3, 12, 6, 2],
              [4, 8, 3],
              [5, 8, 0, 2],
              [6, 7, 4, 1],
            ],
          },
        ],
      },
    },
  ],
  ci: 1,
  mo: {
    speed: 'speed-module-3',
    productivity: 'productivity-module',
    'angels-bio-yield': 'angels-bio-yield-module-5',
  },
  be: 'bob-beacon-2',
  bt: 'bob-turbo-transport-belt',
  fa: 'infinite-mining',
};
