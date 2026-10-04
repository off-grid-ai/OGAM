import { useSpeakerProfilesStore } from '../speakerProfilesStore'

const M = 'voice:test-space'
const OTHER = 'voice:other-space'

function reset() {
  useSpeakerProfilesStore.setState({ profiles: {}, ownerPersonId: null })
}

describe('speakerProfilesStore — owner designation', () => {
  beforeEach(reset)

  it('auto-designates the first human enrollment as the owner', () => {
    const s = useSpeakerProfilesStore.getState()
    const id = s.enroll('Sidd', M, [[1, 0, 0]])
    const st = useSpeakerProfilesStore.getState()
    expect(st.ownerPersonId).toBe(st.profiles[id].personId)
    expect(st.ownerSpeakerId(M)).toBe(id)
  })

  it('does not change the owner when a second person is enrolled', () => {
    const s = useSpeakerProfilesStore.getState()
    const me = s.enroll('Sidd', M, [[1, 0, 0]])
    useSpeakerProfilesStore.getState().enroll('Priya', M, [[0, 1, 0]])
    const st = useSpeakerProfilesStore.getState()
    expect(st.ownerPersonId).toBe(st.profiles[me].personId)
  })

  it('a re-embed backfill (explicit personId) never hijacks ownership', () => {
    const s = useSpeakerProfilesStore.getState()
    const me = s.enroll('Sidd', M, [[1, 0, 0]])
    const ownerPerson = useSpeakerProfilesStore.getState().profiles[me].personId
    // Backfill the SAME person into another model space (what ensureEngineProfiles does).
    useSpeakerProfilesStore.getState().enroll('Sidd', OTHER, [[1, 0, 0]], { personId: ownerPerson })
    // And a brand-new backfill-style enroll carrying a foreign personId must not claim ownership either.
    useSpeakerProfilesStore.getState().enroll('Ghost', OTHER, [[0, 0, 1]], { personId: 'person-x' })
    expect(useSpeakerProfilesStore.getState().ownerPersonId).toBe(ownerPerson)
  })

  it('resolves the owner speakerId per model space (personId shared across spaces)', () => {
    const s = useSpeakerProfilesStore.getState()
    const me = s.enroll('Sidd', M, [[1, 0, 0]])
    const person = useSpeakerProfilesStore.getState().profiles[me].personId
    const meOther = useSpeakerProfilesStore.getState().enroll('Sidd', OTHER, [[1, 0, 0]], { personId: person })
    expect(useSpeakerProfilesStore.getState().ownerSpeakerId(M)).toBe(me)
    expect(useSpeakerProfilesStore.getState().ownerSpeakerId(OTHER)).toBe(meOther)
    expect(useSpeakerProfilesStore.getState().ownerSpeakerId('voice:absent-space')).toBeNull()
  })

  it('setOwner overrides the auto choice', () => {
    const s = useSpeakerProfilesStore.getState()
    s.enroll('Sidd', M, [[1, 0, 0]])
    const priya = useSpeakerProfilesStore.getState().enroll('Priya', M, [[0, 1, 0]])
    const priyaPerson = useSpeakerProfilesStore.getState().profiles[priya].personId
    useSpeakerProfilesStore.getState().setOwner(priyaPerson)
    expect(useSpeakerProfilesStore.getState().ownerSpeakerId(M)).toBe(priya)
  })

  it('clears a dangling owner when the owner’s last profile is removed', () => {
    const s = useSpeakerProfilesStore.getState()
    const me = s.enroll('Sidd', M, [[1, 0, 0]])
    useSpeakerProfilesStore.getState().remove(me)
    expect(useSpeakerProfilesStore.getState().ownerPersonId).toBeNull()
  })

  it('keeps the owner when only one of several model-space variants is removed', () => {
    const s = useSpeakerProfilesStore.getState()
    const me = s.enroll('Sidd', M, [[1, 0, 0]])
    const person = useSpeakerProfilesStore.getState().profiles[me].personId
    useSpeakerProfilesStore.getState().enroll('Sidd', OTHER, [[1, 0, 0]], { personId: person })
    useSpeakerProfilesStore.getState().remove(me)
    expect(useSpeakerProfilesStore.getState().ownerPersonId).toBe(person)
    expect(useSpeakerProfilesStore.getState().ownerSpeakerId(OTHER)).not.toBeNull()
  })

  it('clear() forgets profiles and owner together', () => {
    const s = useSpeakerProfilesStore.getState()
    s.enroll('Sidd', M, [[1, 0, 0]])
    useSpeakerProfilesStore.getState().clear()
    const st = useSpeakerProfilesStore.getState()
    expect(st.profiles).toEqual({})
    expect(st.ownerPersonId).toBeNull()
  })
})
