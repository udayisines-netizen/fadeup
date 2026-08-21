import React from 'react'
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { BEATS, BORDER, BRAND, DEMO, FONT, START } from './brand'
import { Avatar, Enter, Eyebrow, Field, Lane, Mark, Panel, Stage, Sweep, Title } from './ui'

/**
 * "Une journée avec FadeUp" — the /for-business product film.
 *
 * Eleven beats, ~33 silent seconds, one customer. Malik R. walks in, waits,
 * gets a chair, gets cut, becomes a Passport, and books again — and the last
 * frame puts that booking back into the same Today view the film opened on.
 * The loop closing is the whole argument: FadeUp is not six tools, it is one
 * system a customer travels through.
 *
 * The film is silent by contract. Nothing is explained by voiceover, so every
 * beat has to carry its meaning in typography, product UI and direction of
 * movement. Transitions are a single left-to-right emerald→mint sweep derived
 * from the F mark — continuity, not spectacle.
 *
 * Copy is French: FadeUp's first market is France, and baked-in video text
 * cannot follow the page's locale switch. The surrounding section is fully
 * translated, and the film is decorative, so a non-French visitor loses
 * atmosphere and no argument.
 */
export function ProductFilm() {
  return (
    <AbsoluteFill style={{ background: BRAND.navy }}>
      <Sequence durationInFrames={BEATS.open}>
        <Open />
      </Sequence>

      <Sequence from={START.today} durationInFrames={BEATS.today}>
        <Today />
      </Sequence>

      <Sequence from={START.appointment} durationInFrames={BEATS.appointment}>
        <Appointment />
      </Sequence>

      <Sequence from={START.walkin} durationInFrames={BEATS.walkin}>
        <WalkIn />
      </Sequence>

      <Sequence from={START.queue} durationInFrames={BEATS.queue}>
        <Queue />
      </Sequence>

      <Sequence from={START.assign} durationInFrames={BEATS.assign}>
        <Assign />
      </Sequence>

      <Sequence from={START.chair} durationInFrames={BEATS.chair}>
        <ChairMode />
      </Sequence>

      <Sequence from={START.passport} durationInFrames={BEATS.passport}>
        <Passport />
      </Sequence>

      <Sequence from={START.time} durationInFrames={BEATS.time}>
        <TimePassage />
      </Sequence>

      <Sequence from={START.rebook} durationInFrames={BEATS.rebook}>
        <Rebook />
      </Sequence>

      <Sequence from={START.end} durationInFrames={BEATS.end}>
        <EndFrame />
      </Sequence>

      {/* Sweeps sit above every beat so the wipe crosses the cut, not inside it. */}
      {[START.today, START.queue, START.chair, START.rebook, START.end].map((at) => (
        <Sweep key={at} at={at - 10} />
      ))}
    </AbsoluteFill>
  )
}

const PAD = { padding: '90px 110px', height: '100%', display: 'flex', flexDirection: 'column' } as const

/* ------------------------------------------------------------ 1. open */

function Open() {
  const frame = useCurrentFrame()
  const clock = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const line = interpolate(frame, [26, 42], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <Stage sunken>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <div style={{ opacity: clock, fontFamily: FONT, fontSize: 42, color: BRAND.mint, letterSpacing: '0.2em' }}>
          09:00
        </div>
        <div style={{ opacity: line, marginTop: 28 }}>
          <Title size={92}>Le salon ouvre.</Title>
        </div>
      </div>
    </Stage>
  )
}

/* ----------------------------------------------------------- 2. today */

/** The day assembling itself — lanes arrive one after another, never all at once. */
function Today({ highlightIndex, extra }: { highlightIndex?: number; extra?: React.ReactNode }) {
  return (
    <Stage>
      <div style={PAD}>
        <Eyebrow>Aujourd’hui · {DEMO.shop}</Eyebrow>
        <div style={{ marginTop: 18 }}>
          <Title>La journée est déjà en place.</Title>
        </div>

        <div style={{ display: 'flex', gap: 34, marginTop: 52, flex: 1 }}>
          <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {DEMO.barbers.map((barber, index) => (
              <Enter key={barber} at={8 + index * 9}>
                <Lane
                  name={barber}
                  status={index === 0 ? '10:30 · Skin fade' : index === 1 ? 'Libre' : '11:00 · Beard trim'}
                  occupant={index === 0 ? 'TL' : undefined}
                  highlight={highlightIndex === index}
                />
              </Enter>
            ))}
          </Panel>
          {extra ? <div style={{ width: 460 }}>{extra}</div> : null}
        </div>
      </div>
    </Stage>
  )
}

/* ----------------------------------------------- 3. appointment lands */

/**
 * A booking arriving from outside and settling INTO the day.
 *
 * The horizontal travel is the point: the appointment does not appear in a
 * panel of its own, it crosses the frame and becomes part of Today. That is
 * the difference between a calendar and an operating system.
 */
function Appointment() {
  const frame = useCurrentFrame()
  const travel = interpolate(frame, [10, 44], [420, 0], { extrapolateRight: 'clamp' })
  const fade = interpolate(frame, [10, 26], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <Today
      highlightIndex={1}
      extra={
        <div style={{ transform: `translateX(${travel}px)`, opacity: fade }}>
          <Panel elevated>
            <Eyebrow>Nouveau rendez-vous</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 22 }}>
              <Avatar initials={DEMO.initials} />
              <div>
                <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: BRAND.offwhite }}>
                  {DEMO.customer}
                </div>
                <div style={{ fontFamily: FONT, fontSize: 21, color: BRAND.sage, marginTop: 4 }}>
                  {DEMO.service}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 44, marginTop: 28 }}>
              <Field label="Heure" value="14:30" />
              <Field label="Barber" value="Sofia" />
            </div>
          </Panel>
        </div>
      }
    />
  )
}

/* -------------------------------------------------------- 4. walk-in */

function WalkIn() {
  return (
    <Stage>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={2}>
          <Eyebrow>Sans rendez-vous</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Un client arrive sans rendez-vous.</Title>
          </div>
        </Enter>

        <Enter at={20}>
          <div style={{ marginTop: 56, maxWidth: 900 }}>
            <Panel elevated>
              <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                <Avatar initials={DEMO.initials} size={64} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 36, fontWeight: 600, color: BRAND.offwhite }}>
                    {DEMO.customer}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 23, color: BRAND.sage, marginTop: 6 }}>
                    {DEMO.service}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 21,
                    color: BRAND.mint,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 999,
                    padding: '12px 24px',
                  }}
                >
                  Premier barber disponible
                </div>
              </div>
            </Panel>
          </div>
        </Enter>
      </div>
    </Stage>
  )
}

/* ---------------------------------------------------------- 5. queue */

/** #3 → #2 → suivant. The queue is the frame's subject, so it gets the whole width. */
function Queue() {
  const frame = useCurrentFrame()
  const position = frame < 34 ? 3 : frame < 66 ? 2 : 1

  return (
    <Stage>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={0}>
          <Eyebrow>File d’attente en direct</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Les clients sans rendez-vous rejoignent la file.</Title>
          </div>
        </Enter>

        <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 64 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 200,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              color: position === 1 ? BRAND.mint : BRAND.offwhite,
              minWidth: 300,
            }}
          >
            {position === 1 ? 'À vous' : `#${position}`}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[3, 2, 1].map((slot) => (
              <div
                key={slot}
                style={{
                  height: 18,
                  borderRadius: 9,
                  background: slot >= position ? BRAND.emerald : 'rgba(255,255,255,0.06)',
                  opacity: slot >= position ? 1 : 0.5,
                  transition: 'none',
                }}
              />
            ))}
            <div style={{ fontFamily: FONT, fontSize: 24, color: BRAND.sage, marginTop: 12 }}>
              {DEMO.customer} · {DEMO.service}
            </div>
          </div>
        </div>
      </div>
    </Stage>
  )
}

/* ------------------------------------------------- 6. barber assignment */

/** The queue entry travelling into a specific lane, rather than cutting to it. */
function Assign() {
  const frame = useCurrentFrame()
  const drop = interpolate(frame, [6, 38], [-190, 0], { extrapolateRight: 'clamp' })
  const fade = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <Stage>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={0}>
          <Eyebrow>Attribution</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Sofia prend le client suivant.</Title>
          </div>
        </Enter>

        <div style={{ marginTop: 56, maxWidth: 960, position: 'relative' }}>
          <Panel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Lane name="Yanis" status="En coupe" occupant="TL" />
              <div style={{ transform: `translateY(${drop}px)`, opacity: fade }}>
                <Lane name="Sofia" status={DEMO.service} occupant={DEMO.initials} highlight />
              </div>
              <Lane name="Deniz" status="11:00 · Beard trim" />
            </div>
          </Panel>
        </div>
      </div>
    </Stage>
  )
}

/* ----------------------------------------------------- 7. chair mode */

function ChairMode() {
  return (
    <Stage sunken>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={0}>
          <Eyebrow>Chair Mode · Fauteuil 2</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Le barber retrouve la prestation et l’historique.</Title>
          </div>
        </Enter>

        <Enter at={18}>
          <div style={{ marginTop: 52 }}>
            <Panel elevated style={{ padding: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <Avatar initials={DEMO.initials} size={76} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 42, fontWeight: 600, color: BRAND.offwhite }}>
                    {DEMO.customer}
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 24, color: BRAND.sage, marginTop: 6 }}>
                    {DEMO.service}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 60,
                  marginTop: 40,
                  paddingTop: 32,
                  borderTop: `1px solid ${BORDER}`,
                }}
              >
                <Field label="Dernière coupe" value="Fade 1 · 18 jours" />
                <Field label="Finition" value="Contour net" />
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 40 }}>
                <div
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '20px 0',
                    borderRadius: 12,
                    background: BRAND.emerald,
                    color: '#04120B',
                    fontFamily: FONT,
                    fontSize: 25,
                    fontWeight: 600,
                  }}
                >
                  Terminer
                </div>
                <div
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '20px 0',
                    borderRadius: 12,
                    border: `1px solid ${BORDER}`,
                    color: BRAND.offwhite,
                    fontFamily: FONT,
                    fontSize: 25,
                    fontWeight: 500,
                  }}
                >
                  Suivant
                </div>
              </div>
            </Panel>
          </div>
        </Enter>
      </div>
    </Stage>
  )
}

/* -------------------------------------------------- 8. fade passport */

function Passport() {
  const rows: [string, string][] = [
    ['Fade', 'Skin · 1'],
    ['Dessus', '4 cm texturé'],
    ['Barbe', 'Contour net'],
    ['Rythme', 'Toutes les 3 semaines'],
  ]

  return (
    <Stage sunken>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={0}>
          <Eyebrow>Fade Passport</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Fade Passport conserve les détails de la coupe.</Title>
          </div>
        </Enter>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginTop: 56, maxWidth: 1100 }}>
          {rows.map(([label, value], index) => (
            <Enter key={label} at={14 + index * 8}>
              <Panel style={{ padding: 26 }}>
                <Field label={label} value={value} />
              </Panel>
            </Enter>
          ))}
        </div>
      </div>
    </Stage>
  )
}

/* ------------------------------------------------------ 9. time passage */

function TimePassage() {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 12, 44, 58], [0, 1, 1, 0], { extrapolateRight: 'clamp' })

  return (
    <Stage sunken>
      <div style={{ ...PAD, justifyContent: 'center', opacity }}>
        <Title size={80}>18 jours plus tard.</Title>
      </div>
    </Stage>
  )
}

/* ---------------------------------------------------------- 10. rebook */

/** The customer's phone, then the booking travelling back into the shop's day. */
function Rebook() {
  const frame = useCurrentFrame()
  const handoff = interpolate(frame, [58, 92], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <Stage>
      <div style={{ ...PAD, justifyContent: 'center' }}>
        <Enter at={0}>
          <Eyebrow>Côté client</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <Title>Le même barber, la même prestation.</Title>
          </div>
        </Enter>

        <div style={{ display: 'flex', alignItems: 'center', gap: 60, marginTop: 54 }}>
          <Enter at={16}>
            {/* A phone, drawn as a narrow rounded surface — no 3D device render. */}
            <div
              style={{
                width: 360,
                borderRadius: 34,
                border: `1px solid ${BORDER}`,
                background: BRAND.surface,
                padding: 30,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Avatar initials="SO" size={48} />
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 25, fontWeight: 600, color: BRAND.offwhite }}>
                    Sofia
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 18, color: BRAND.sage }}>{DEMO.shop}</div>
                </div>
              </div>
              <div style={{ marginTop: 26, fontFamily: FONT, fontSize: 20, color: BRAND.sage }}>
                {DEMO.service}
              </div>
              <div
                style={{
                  marginTop: 26,
                  textAlign: 'center',
                  padding: '18px 0',
                  borderRadius: 12,
                  background: BRAND.emerald,
                  color: '#04120B',
                  fontFamily: FONT,
                  fontSize: 23,
                  fontWeight: 600,
                }}
              >
                Reprendre rendez-vous
              </div>
            </div>
          </Enter>

          {/* The confirmed booking flowing back into Today. */}
          <div style={{ flex: 1, opacity: handoff, transform: `translateX(${interpolate(handoff, [0, 1], [-70, 0])}px)` }}>
            <Panel elevated>
              <Eyebrow>Aujourd’hui · {DEMO.shop}</Eyebrow>
              <div style={{ marginTop: 22 }}>
                <Lane name="Sofia" status={`14:30 · ${DEMO.service}`} occupant={DEMO.initials} highlight />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </Stage>
  )
}

/* -------------------------------------------------------------- 11. end */

function EndFrame() {
  const frame = useCurrentFrame()
  const mark = interpolate(frame, [4, 24], [0, 1], { extrapolateRight: 'clamp' })
  const line = interpolate(frame, [26, 44], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <Stage sunken>
      <div style={{ ...PAD, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ opacity: mark }}>
          <Mark size={112} />
        </div>
        <div style={{ opacity: line, marginTop: 40 }}>
          <Title size={78}>Un seul système, du premier rendez-vous au suivant.</Title>
        </div>
        <div
          style={{
            opacity: line,
            marginTop: 26,
            fontFamily: FONT,
            fontSize: 30,
            letterSpacing: '0.04em',
            color: BRAND.sage,
          }}
        >
          FadeUp
        </div>
      </div>
    </Stage>
  )
}
