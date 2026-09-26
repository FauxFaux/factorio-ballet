# GPL algorithm map

This is a guide to the _current_ OpenROAD global placer for an agent building or adapting a similar
analytic placer. The historical starting point is
[Lu et al., “ePlace: Electrostatics Based Placement Using Nesterov’s Method,” DAC 2014](https://doi.org/10.1145/2593069.2593133)
(the paper supplied as `2593069.2593133.pdf`). Section and equation numbers below refer to that
paper. GPL descends from RePlAce; the paper is an explanation of its core ideas, not a specification
of the present command or complete flow.

Paths relative to a sibling checkout at ~/clone/openroad.

## Execution map

| Task                                                 | Current code                                                                                                                                                                                                        | Paper                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Parse options and enter placement                    | [`replace.tcl`](src/replace.tcl), [`Replace::doPlace`](src/replace.cpp), [`PlaceOptions`](include/gpl/Replace.h)                                                                                                    | §III, Fig. 1           |
| Build movable/fixed objects, nets, pins, and regions | [`PlacerBaseCommon`/`PlacerBase`](src/placerBase.cpp), [`NesterovBaseCommon`/`NesterovBase`](src/nesterovBase.cpp)                                                                                                  | §II–III                |
| Generate low-wirelength starting coordinates         | [`InitialPlace::doBicgstabPlace`](src/initialPlace.cpp), [`createSparseMatrix`](src/initialPlace.cpp), [`cpuSparseSolve`](src/solver.cpp)                                                                           | §III, mIP              |
| Add fillers and form density bins                    | [`NesterovBase::initFillerGCells`](src/nesterovBase.cpp), [`BinGrid::initBins`](src/nesterovBase.cpp), [`BinGrid::updateBinsGCellDensityArea`](src/nesterovBase.cpp)                                                | §III–IV                |
| Compute weighted-average wirelength force            | [`NesterovBaseCommon::updateWireLengthForceWA`](src/wirelengthGradient.cpp), [`getWireLengthGradientPinWA`](src/nesterovBase.cpp)                                                                                   | Eq. (3)                |
| Solve for electrostatic density force                | [`NesterovBase::updateDensityFieldBin`](src/nesterovBase.cpp), [`CpuFftBackend::solve`](src/fft.cpp), [`getDensityGradient`](src/nesterovBase.cpp)                                                                  | Eq. (5)–(8)            |
| Combine and precondition forces                      | [`NesterovBase::updateGradients`](src/nesterovBase.cpp)                                                                                                                                                             | §V-D, Eq. (11)–(13)    |
| Optimize, backtrack, and stop                        | [`NesterovPlace::doNesterovPlace`](src/nesterovPlace.cpp), [`doBackTracking`](src/nesterovPlace.cpp), [`NesterovBase::nesterovUpdateCoordinates`](src/nesterovBase.cpp), [`checkConvergence`](src/nesterovBase.cpp) | §V-B–C, Algorithms 1–2 |
| Optional timing and routing feedback                 | [`TimingBase`](src/timingBase.cpp), [`RouteBase`](src/routeBase.cpp), [`NesterovPlace::runTimingDriven`](src/nesterovPlace.cpp), [`runRoutability`](src/nesterovPlace.cpp)                                          | Beyond this paper      |

The normal `global_placement` path runs initial placement followed by Nesterov placement. Both
stages have command options for skipping them; incremental placement has its own orchestration in
`Replace::doIncrementalPlace`. `Replace::initNesterovPlace` creates one `NesterovBase` per
top-level/fence region, sharing net and pin data through `NesterovBaseCommon`. The result is written
back to OpenDB by `NesterovPlace::updateDb`.

## Objective and physical model

The paper starts with minimizing half-perimeter wirelength (HPWL) subject to per-bin capacity (Eq.
(1)–(2)). HPWL is nonsmooth. Eq. (3) replaces each net's extrema with weighted averages of pin
coordinates, using positive and negative exponentials and a smoothing scale `gamma`. In code,
`wlCoeffX/Y` play the inverse-scale role. `updateWireLengthForceWA_native` shifts exponentials by
each net's bounding box for numerical stability, and `getWireLengthGradientPinWA` computes a pin's
contribution. Net weights can modify that contribution. `hpwl.cpp` computes actual HPWL for
reporting and control; it is distinct from the smooth gradient.

Eq. (4) adds a density penalty to the smooth wirelength objective:
`f(v) = W_smooth(v) + lambda * N(v)`. Each movable cell or macro contributes area to a spatial
charge distribution; artificial, unconnected filler cells occupy unused target-density area and
receive density force but no wirelength force. `initFillerGCells` computes the filler budget from
available area, movable area, and target density. Fixed objects and blockages enter bin occupancy
through `BinGrid::updateBinsNonPlaceArea`.

The paper's Eq. (5)–(8) defines density energy through potential `psi` and field `xi`: solve a
zero-mean Poisson problem on the rectangular bin grid with zero normal derivative at the boundary,
then use the field to push area away from crowding. In the CPU implementation,
`BinGrid::updateBinsGCellDensityArea` scatters cell/filler overlap into bins and computes occupancy
and overflow; `updateDensityFieldBin` sends bin density to `FFT`; `CpuFftBackend::solve` uses
cosine/sine transforms, sets the zero-frequency component to zero, and returns potential and x/y
fields. `getDensityGradient` sums each overlapped bin's field weighted by the cell's overlap area
and density scale. Use the code's force and penalty conventions when reproducing it: the paper
writes an explicit factor of two in Eq. (8), while the implementation's density gradient and
calibrated penalty do not expose that same factor separately.

Density is an _optimization_ model, not a final legalizer. The bin density denominator includes
target density, and there are scaled and unscaled overflow measures in
`BinGrid::updateBinsGCellDensityArea`. Convergence uses the unscaled overflow normalized by movable
instance area (with a special denominator adjustment for macro-dominated designs), not the field
energy.

## One Nesterov iteration

The main loop is `NesterovPlace::doNesterovPlace`; its initialization is in `NesterovPlace::init`
and `NesterovBase::initDensity1/2`. The two coordinate streams are the ordinary point (`curCoordi_`)
and the extrapolated point (`curSLPCoordi_`). Gradients and density fields are evaluated at the
latter. For an unconstrained cell, the CPU update in `nesterovUpdateCoordinates` is equivalent to:

```text
a_next = (1 + sqrt(1 + 4*a*a)) / 2
momentum = (a - 1) / a_next
ordinary_next = extrapolated_current + step * preconditioned_force
extrapolated_next = ordinary_next
                    + momentum * (ordinary_next - ordinary_current)
```

This corresponds to paper §V-B, Algorithm 1. The implementation stores a _force/descent direction_
in its combined gradient vectors, so the coordinate update uses `+ step * ...`; do not copy that
sign into a conventional mathematical `+gradient` implementation without checking direction.
Coordinates are clipped to the placement region. Locked objects stay fixed. Optional IO pin
placement projects pins onto their allowed perimeter or region locus and handles mirror constraints;
see the IO helpers in `nesterovBase.cpp`.

`NesterovBase::updateGradients` forms wirelength force plus `densityPenalty_ * density force`. It
divides each coordinate by a positive diagonal preconditioner: pin count plus
`densityPenalty_ * cell area`, with a minimum floor. This is the practical analogue of
`|E_i| + lambda*q_i` in paper §V-D; the code uses **pin count** and physical cell area, so a literal
net-degree implementation is not identical. It prevents large macros from dominating the step solely
because they have much more area.

The initial penalty is scaled by the ratio of wirelength and density force sums in `initDensity2`.
After each accepted iteration, `updateNextIter` changes it using `getPhiCoef`, driven by the change
in actual HPWL relative to `referenceHpwl`. `NesterovPlace::updateWireLengthCoef` separately changes
wirelength smoothing with overflow. These changing coefficients mean the optimizer is following a
sequence of related objectives, not a single fixed function for the entire run.

Step length estimates the inverse local gradient Lipschitz constant as
`||position difference|| / ||preconditioned force difference||` (`NesterovBase::getStepLength`;
paper §V-B, Eq. (10)). `doBackTracking` tries the candidate step, recomputes the density field and
both forces, and calls `nesterovUpdateStepLength`. This is the paper's §V-C, Algorithm 2, with
code-specific bounds and a finite retry limit. The controller also checks invalid values and can
save/revert a low-HPWL placement on divergence. Each region can converge when its unscaled overflow
reaches `targetOverflow`; the controller stops when all regions have converged or its iteration
limit is reached. `updateDb` commits final coordinates.

## Where the current flow differs from the paper

The paper's Fig. 1 includes simulated-annealing macro legalization (mLG), a second standard-cell
global-placement phase (cGP), and detailed placement (cDP). **`global_placement` in GPL does not
implement that Fig. 1 sequence.** Macro placement/legalization and detailed placement are separate
OpenROAD flow steps; do not search for the paper's annealer inside `NesterovPlace`.

Modern GPL also supports fence regions, incremental placement, movable IO pins, placement clusters,
pin-density area adjustment, timing-driven net weights/repair, virtual CTS, and routability-driven
inflation and restart. Read `placerBase.cpp`, `timingBase.cpp`, `clockBase.cpp`, and `routeBase.cpp`
before changing those semantics. CPU and optional GPU paths share the algorithm but differ in data
movement: dispatch lives in [`wirelengthGradient.cpp`](src/wirelengthGradient.cpp),
[`densityGradient.cpp`](src/densityGradient.cpp), and [`fft.cpp`](src/fft.cpp); GPU implementations
are under [`src/gpu/`](src/gpu/). The GPU path may keep coordinates, gradients, and bins on device
during the loop, then synchronize before OpenDB updates. For a port, preserve the mathematical
operations and state transitions first, then choose its own execution backend.

For command behavior and option defaults, use [`README.md`](README.md) and
`replace.tcl`/`PlaceOptions`; for architecture, start at `Replace::doPlace` and follow the map
above. The RePlAce and ePlace-MS references in `README.md` provide further historical context, but
the source remains authoritative for current behavior.
