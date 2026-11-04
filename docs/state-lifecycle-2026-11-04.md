# State lifecycle repair, 4 November 2026

Bind media lease release to the actual lease instance.

Scope: `t3mr0i/my-looi-ios` at `63e18d6c01a3db8b4130716851458fecf4cf7482`. Kai requested an audit and fixes for apps updated 21 October–4 November 2026.

- An old conversation lease can no longer release a later lease sharing the owner name.

Verification: 1 lease regression fails before and passes after; no native media or device session run.

Integration: isolated review branch; no deployment is asserted. The inventory is a static map of overlapping lifecycles, not proof that every possible transition was reviewed.
