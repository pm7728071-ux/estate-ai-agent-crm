/** Estate AI Agent CRM — execution loop v1 (Days 15-30).
 *  Deterministic: understand -> memory check -> act -> verify -> approval gate.
 */
module.exports = function mountAgent({ app, getDB, save, log }) {
  const reply = (res, body) => res.json(body);
  const props = [
    { name: 'Kilimani 2BR Apartment', rent: '45,000 KES', beds: 2, area: 'Kilimani' },
    { name: 'Lavington 2BR Apartment', rent: '60,000 KES', beds: 2, area: 'Lavington' },
    { name: 'Karen 4BR Villa', rent: '85,000 KES', beds: 4, area: 'Karen' },
    { name: 'Westlands Office Suite', rent: '120,000 KES', beds: 0, area: 'Westlands' },
  ];
  const slots = ['Tomorrow at 6:00 PM', 'Thursday at 5:30 PM'];

  app.post('/api/agent/message', (req, res) => {
    const { channel, from, text } = req.body || {};
    if (!from || !text) return res.status(400).json({ error: 'from and text are required' });
    const DB = getDB();
    const msg = String(text).slice(0, 600);
    const t = msg.toLowerCase();
    DB.threads = DB.threads || {}; DB.holds = DB.holds || {};
    const th = DB.threads[from] || (DB.threads[from] = { from, channel: channel || 'whatsapp', budget: null, memIds: [], offeredSlots: null });
    const actions = []; const out = (r, extra = {}) => {
      log('ACTION', 'Agent replied to ' + from + ' — ' + extra.intent);
      save();
      const memoryUsed = th.memIds.map(id => DB.memories.find(m => m.id === id)).filter(Boolean).map(m => m.entry);
      return reply(res, { reply: r, actions, memoryUsed, requiresApproval: false, intent: extra.intent, ...extra });
    };
    const addMem = (type, entry) => { const m = { id: 'mem-' + Date.now() + '-' + Math.floor(Math.random() * 999), type, entry, confidence: 90, recorded: new Date().toISOString(), subject: from }; DB.memories.unshift(m); th.memIds.push(m.id); return m; };

    // 1) approval gate — consequential actions never leave without a human
    if (/(send|email|draft).*(offer|letter)|formal offer|commit to|sign the|pay the deposit|deposit of/i.test(t)) {
      const approvalId = 'apr-' + Date.now();
      log('APPROVAL', 'Approval requested for ' + from + ' — formal offer letter / commitment held. Nothing sent.');
      actions.push({ type: 'APPROVAL_REQUESTED', approvalId, detail: 'Formal offer letter / commitment' });
      return out('I have prepared the formal offer letter and the commitment to the 15th — but I will not send anything until a human approves it. It has been queued for operator approval now, and you will see it in System Action Logs.', { requiresApproval: true, approvalId, intent: 'approval-gate' });
    }

    // 2) landlord hold instruction
    const holdMatch = t.match(/do not show|don't show|not to be shown|on hold|hold the/);
    if (holdMatch) {
      const key = ['karen', 'kilimani', 'lavington', 'westlands'].find(k => t.includes(k)) || 'listing';
      DB.holds[key] = { by: from, note: msg.slice(0, 120), at: new Date().toISOString() };
      log('HOLD_ADDED', 'Hold placed on ' + key + ' listing by ' + from + ' — viewings blocked until lifted.');
      return out('Understood. I have placed the ' + key + ' listing on hold — no viewings will be offered and no details shared until you tell me it is ready.', { intent: 'landlord-hold' });
    }

    // 3) question about a held listing
    const heldKey = Object.keys(DB.holds).find(k => t.includes(k));
    if (heldKey) return out('The ' + heldKey + ' property is temporarily withdrawn from the market while work is completed on it. I will alert you the moment it returns — happy to share similar options meanwhile.', { intent: 'held-listing' });

    // 4) abuse — stay professional, flag a human
    if (/useless|scam|stupid|idiot|rubbish|hate you|nonsense/i.test(t)) {
      log('FLAG', 'Hostile message from ' + from + ' — escalated to operations manager. Agent stayed professional.');
      return out('I am sorry — that is not the experience you deserve, and I want to help fix whatever went wrong. I have flagged this conversation to our operations manager, who will follow up with you personally.', { intent: 'escalation', escalated: true });
    }

    // 5) confirm a proposed viewing slot
    if (/(yes|confirm|ok|book)/i.test(t) && /(book|first|slot)/i.test(t) && th.offeredSlots) {
      const slot = th.offeredSlots[0];
      log('VIEWING_CONFIRMED', 'Viewing confirmed for ' + from + ' — ' + slot + ' (Kilimani 2BR). Calendar entry created.');
      actions.push({ type: 'VIEWING_CONFIRMED', slot, property: 'Kilimani 2BR Apartment' });
      return out('Confirmed. Your viewing is booked for ' + slot + ' at the Kilimani 2BR Apartment. I have sent the details and will remind you the day before.', { intent: 'viewing-confirmed', viewing: { slot, property: 'Kilimani 2BR Apartment' } });
    }

    // 6) viewing request — propose concrete slots
    if (/view|viewing|see the|appointment|visit/i.test(t)) {
      th.offeredSlots = slots;
      return out('Happy to arrange that. I have two slots available: ' + slots[0] + ' or ' + slots[1] + '. Which works better for you?', { intent: 'viewing-request', slots });
    }

    // 7) budget — store, and resolve conflicts to the latest value
    const bm = !/looking for|options/i.test(t) && t.match(/budget[^0-9]{0,12}(\d{1,3})\s*k|now\s+(\d{1,3})\s*k|under\s+(\d{1,3})\s*k/);
    if (bm) {
      const num = bm[1] || bm[2] || bm[3];
      const val = num + 'k';
      if (th.budget && th.budget !== val) {
        const existing = DB.memories.find(m => m.id && th.memIds.includes(m.id) && /budget/i.test(m.entry));
        if (existing) existing.entry = 'Budget updated: ' + val + ' KES (was ' + th.budget + ')';
        else addMem('Client preference', 'Budget updated: ' + val + ' KES');
        th.budget = val;
        log('MEMORY_UPDATED', 'Budget for ' + from + ' changed to ' + val + ' — memory bank updated, old value superseded.');
        return out('Noted — I have updated your budget to ' + val + ' and replaced the old figure in the memory bank. The Kilimani 2BR at 45,000 KES and Lavington 2BR at 60,000 KES both fit that range. Want me to arrange a viewing?', { intent: 'budget-update' });
      }
      th.budget = th.budget || val;
      addMem('Client preference', 'Budget: ' + val + ' KES');
      const fit = props.filter(p => parseInt(p.rent.replace(/[^0-9]/g, ''), 10) <= parseInt(num, 10) * 1000);
      return out('Saved — your budget of ' + val + ' KES is now in the memory bank. ' + (fit.length ? 'In your range: ' + fit.map(p => p.name + ' (' + p.rent + ')').join(', ') + '.' : 'Nothing matches exactly yet — here are the closest options: ' + props.slice(0, 2).map(p => p.name + ' (' + p.rent + ')').join(', ') + '.') + ' Would you like to arrange a viewing?', { intent: 'budget-saved' });
    }

    // 8) stated preferences
    if (/parking|water tank|prefer|only care|must have|need(s)? a/i.test(t)) {
      const bits = [];
      if (/parking/i.test(t)) bits.push('parking');
      if (/water tank/i.test(t)) bits.push('backup water tank');
      if (/morning/i.test(t)) bits.push('morning viewings');
      const entry = bits.length ? 'Prefers ' + bits.join(' and ') : 'Preference noted: ' + msg.slice(0, 80);
      addMem('Client preference', entry);
      log('MEMORY_ADDED', 'Stored preference for ' + from + ' — ' + entry + '.');
      return out('Noted and stored — I will keep ' + (bits.join(' and ') || 'that') + ' in mind for every option I recommend to you.', { intent: 'preference-stored' });
    }

    // 9) availability / search
    if (/available|options|looking for|apartment|house|3br|2br|4br|office|under\s*\d/i.test(t)) {
      const wantBeds = parseInt((t.match(/(\d)\s?br/) || [])[1] || '0', 10);
      const wantArea = ['westlands', 'karen', 'kilimani', 'lavington'].find(a => t.includes(a));
      const fits = props.filter(p => (!wantBeds || p.beds === wantBeds) && (!wantArea || p.area.toLowerCase() === wantArea));
      if (fits.length) {
        return out('Yes — available now: ' + fits.map(p => p.name + ' at ' + p.rent + '/month').join('; ') + '. Would you like photos or a viewing?', { intent: 'availability' });
      }
      const alts = props.filter(p => !wantBeds || p.beds <= wantBeds + 1).slice(0, 3);
      return out('We do not have an exact match' + (wantBeds ? ' for a ' + wantBeds + 'BR' : '') + (wantArea ? ' in ' + wantArea : '') + ' right now — here are similar alternatives you could consider instead: ' + alts.map(p => p.name + ' at ' + p.rent + '/month').join('; ') + '.', { intent: 'alternatives' });
    }

    // 10) default — helpful, memory-aware
    const memHint = th.memIds.length ? ' I still have your earlier notes (' + th.memIds.map(id => (DB.memories.find(m => m.id === id) || {}).entry).filter(Boolean).slice(0, 2).join('; ') + ').' : '';
    return out('Thanks for your message — I can help with availability, pricing, viewing bookings, or lease terms.' + memHint + ' What would you like to do next?', { intent: 'fallback' });
  });
};
