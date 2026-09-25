# Parameters in the solid-unloading blueprint

[`unload-solids-v3.json`](unload-solids-v3.json) is the parameterised template.
[`undload-solids-v3-salt.json`](undload-solids-v3-salt.json) is a blueprint copied from a placed,
configured salt station. The latter is useful evidence of the result, but it also contains edits and
serialization differences unrelated to parameter substitution.

## The item parameter

The template declares one item ID parameter at the blueprint level:

```json
{ "type": "id", "name": "Type to unload", "id": "parameter-0" }
```

`parameter-0` is a placeholder item signal, not an item to transport. Selecting `angels-solid-salt`
for **Type to unload** during placement resolves that placeholder to the real item ID. The two files
show it in these locations:

| Template use                                                                                             | Salt copy                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 16 inserter `filters[].name` fields contain `parameter-0`                                                | 11 contain `angels-solid-salt`; five filters are absent |
| Arithmetic combinator inputs use `parameter-0` to divide the chest's item count by the item's stack size | Both inputs use `angels-solid-salt`                     |
| Another arithmetic combinator outputs `parameter-0` from `signal-T * 1`                                  | It outputs `angels-solid-salt`                          |
| Train stop name is `[item=parameter-0] Request`                                                          | It is `[item=angels-solid-salt] Request`                |

The `signal-T` constant selects the requested item signal, and the arithmetic combinator converts it
to the chosen item's signal for the unloading inserters. The other arithmetic combinator uses that
item signal on two separate wire networks to calculate a stack count (`signal-S`). The item name in
the station label is Factorio rich text; it is substituted too.

This is one parameter reused in several fields, not a separate parameter for each inserter or
combinator. The salt copy has no `blueprint.parameters` array and no `parameter-0` references: it
records a concrete station rather than the original configurable template.

## The numeric parameter

The template also declares:

```json
{ "type": "number", "number": "-400", "name": "Per-station request stack count manipulation" }
```

The number `-400` occurs as the `count` of a `signal-M` filter in the first section of the constant
combinator (entity 52 in the template). After entering `-300` during placement, the corresponding
filter is `-300` in the salt copy (entity 54). A different `signal-M` filter in its second section
stays at `400`; `signal-W` stays at `80`. Thus the changed value is a specific constant-combinator
count, not a global rewrite of every number or every `signal-M`.

There is no literal `parameter-1` reference in either blueprint. The
[Parameterisation section of the blueprint wiki](../blueprint.wiki) explains that signals **and
their values** can be selected as separate parameters in the game's setup GUI. A selected constant
gets its own placement prompt; it does not become a `parameter-N` signal. The JSON exports this
numeric parameter as its default `"number": "-400"`, and still stores `-400` in the combinator
filter. The second entry in the `parameters` array is therefore the numeric prompt, even though no
field contains `parameter-1`.

The wiki also says that equal values from multiple sources are treated as one parameter. That
explains why the exported metadata has a value rather than a field path, but the JSON alone does not
specify a robust mapping for every possible blueprint. Here `-400` occurs in only one entity field,
so its `-300` replacement is unambiguous. The separate positive `400` is a different value and was
not changed.

## Implications for ingestion and generation

For the narrow case of **one regular item ID used in multiple places**, a generator can preserve the
template's `parameters` declaration and use the same `parameter-0` placeholder wherever that item is
required. An ingester must accept `parameter-0` as a valid placeholder signal instead of requiring
an item prototype with that name. On configuration, the selected item ID replaces those references,
including the item name inside a rich-text station label.

Treat numeric values as a separate kind of parameter. The game groups equal configured values in its
parameterisation GUI, while this fixture only proves the round trip for a unique `-400` count.
Supporting numeric parameter generation for more complicated blueprints should have an in-game
round-trip test of the exact JSON shape we emit. Likewise, the salt copy's missing five inserter
filters should not be reproduced as an item-substitution rule.

The [blueprint wiki](../blueprint.wiki) explains the placement UI and how parameter values are
grouped. The [blueprint string format wiki](../blueprint-string.wiki) describes the older JSON
object but does not list the blueprint-level `parameters` field. The local Factorio Lua API
describes blueprint entities and import/export, but does not specify this exported parameter
binding. For the JSON shape used here, the two Factorio-produced blueprints are the concrete
evidence.
