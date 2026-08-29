# FadeUp Motion System

## Objective

FadeUp motion should create the physical continuity and responsiveness associated with high-quality native mobile products.

Apple interaction quality is a principle reference.

Do not copy proprietary implementation details.

Motion must support:

- feedback
- continuity
- orientation
- state change
- perceived responsiveness

It must never become decorative friction.

---

# 1. Motion principles

Every animation must answer at least one question:

- What did I touch?
- What changed?
- Where did this content come from?
- Where did it go?
- What is selected?
- What should I do next?

If it answers none of these, remove it.

---

# 2. Button press

Interactive buttons should respond immediately.

Baseline behavior:

pointer/touch down
→ scale approximately 0.97–0.985
→ immediate visual feedback
→ release with a restrained spring
→ action/transition

Do not delay the actual action waiting for a decorative animation.

---

# 3. Navigation icon

Bottom-navigation selection may use:

- small scale response
- icon/state transition
- subtle spring

Keep the animation short.

Do not bounce excessively.

---

# 4. Timing bands

Use these as FadeUp defaults, not rigid rules:

Micro feedback:
100–180ms

Standard UI transition:
180–280ms

Sheet/page transformation:
240–420ms

Large spatial/shared transition:
300–500ms when genuinely justified

Avoid long animations for repetitive actions.

---

# 5. Spring character

FadeUp springs should feel:

- controlled
- responsive
- slightly physical
- never cartoonish

Avoid excessive overshoot.

Use stronger spring character for:

- press release
- queue position change
- selected state
- successful confirmation

Use calmer easing for:

- page content
- overlays
- large layout movement

---

# 6. Card → Profile continuity

When technically appropriate:

Marketplace result
→ profile

should preserve spatial continuity.

The originating image/card can visually become part of the destination profile.

The goal is to make the user understand:

"This is the same person/place I just selected."

Do not force complex shared-element code where it creates fragility.

Fallback transitions must still feel deliberate.

---

# 7. Portfolio → Viewer

Opening work media should visually originate from the selected grid item.

Preferred feeling:

grid item
→ expands
→ work viewer

Closing should reverse the spatial relationship where feasible.

---

# 8. Booking transformation

Booking should avoid abrupt full-screen wizard transitions.

From a Barber Profile:

Book
→ booking state becomes visible within the same experience
→ service selection
→ time selection
→ confirmation

Each state should feel like the previous state transformed.

Do not repeatedly destroy and recreate unrelated modal surfaces.

---

# 9. Service selection

Selecting a service should provide immediate:

- pressed response
- selected state
- contextual continuation

The user should instantly understand which service is active.

---

# 10. Slot selection

Time-slot tap:

tap
→ small scale/press feedback
→ selected state
→ next action becomes available

Do not animate every slot simultaneously.

---

# 11. Booking confirmation

Confirmation should feel calm and final.

Use:

- concise success transition
- restrained confirmation mark
- optional supported haptic feedback

Do not use:

- confetti by default
- large celebratory effects
- long blocking animation

---

# 12. Queue

Realtime queue transitions are a signature use of motion.

Example:

#4
→ #3
→ #2
→ #1
→ You're next

A position update should visibly transition rather than silently replace text.

Use restrained spring/number motion.

Do not make realtime updates visually chaotic.

---

# 13. Fade Passport

Passport may use:

- subtle perspective/tilt
- restrained light response
- spring when opened
- Wallet-like spatial transition

Do not make the Passport a 3D demo.

Function remains primary.

---

# 14. Sheets and overlays

Sheets should feel attached to the current task.

Opening:

current context remains perceptually present
+
sheet moves into the foreground

Closing:

returns naturally to the source state

Do not stack several modal layers unless strictly necessary.

---

# 15. Search

Entering Search can transition from the existing search affordance into a focused search state.

The user's visual focus should move naturally to the text input.

Keyboard opening must not create layout jumps or hidden controls.

---

# 16. Haptics

Where supported and appropriate, haptic feedback may accompany:

- Follow
- important selection
- booking confirmation
- queue join
- important queue state such as You're next

Haptics are enhancement only.

Core UX must not depend on them.

Web/PWA support varies by platform.

Do not fake unsupported native capabilities.

---

# 17. Loading

Prefer:

- stable skeletons
- progressive content reveal
- preserved layout

Avoid:

- content jumping
- decorative loading spinners everywhere
- fake progress

---

# 18. Realtime updates

Realtime state should transition locally.

Do not reanimate the entire page because one value changed.

Examples:

queue position changes
→ animate queue position only

appointment status changes
→ animate relevant status

new activity
→ insert smoothly without resetting scroll

---

# 19. Reduced Motion

Respect reduced-motion user preferences.

When reduced motion is requested:

- remove scale-heavy transitions
- remove large spatial transformations
- remove tilt
- reduce spring
- preserve immediate state feedback

Functionality must remain identical.

---

# 20. Performance

Motion must remain performant on realistic mobile hardware.

Prefer compositor-friendly properties when possible.

Avoid expensive layout animation across large page trees.

Never sacrifice input responsiveness.

---

# 21. Motion review gate

For every major surface, browser QA must verify:

- no sluggish button feedback
- no animation blocking navigation
- no layout shifts
- no portal/theme visual breaks
- reduced-motion behavior
- no mobile scroll jank
- no keyboard overlap
- no accidental repeated animation during realtime updates
