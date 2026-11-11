"""Generate a standalone diagram of the implemented service boundaries."""
from pathlib import Path
from html import escape
p=Path(__file__).resolve().parent
out=['<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1010" viewBox="0 0 1500 1010" font-family="Arial,sans-serif" role="img" aria-labelledby="title desc"><title id="title">Assay backend service architecture</title><desc id="desc">Five services with private databases, mandatory AI assessment and PayPal settlement, and an isolated media verifier. Local prototype verified. Actual sandbox and provider tests pending.</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#65809b"/></marker></defs><rect width="1500" height="1010" fill="#f4f7fb"/>']
def text(x,y,t,size=16,color='#24435e',weight='400',anchor='start'):
 out.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(t)}</text>')
def box(x,y,w,h,title,lines,color='#3875a5',bg='white'):
 out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" stroke="{color}" stroke-width="1.6" fill="{bg}"/>')
 text(x+w/2,y+30,title,20,'#183b59','700','middle')
 for i,line in enumerate(lines):text(x+w/2,y+56+i*23,line,15,'#526b80','400','middle')
def arrow(x,y,x2,y2):out.append(f'<path d="M{x} {y} L{x2} {y2}" fill="none" stroke="#65809b" stroke-width="1.8" marker-end="url(#arrow)"/>')
text(30,44,'Assay | AI outcome assurance for video delivery: backend services',29,'#183b59','700')
text(30,76,'11 NOV 2026 · Five services, five PostgreSQL databases, isolated verifier · runs in Docker Compose',16)
box(30,110,1440,140,'Commerce service',['Buyer contract + consent · logical units · durable saga · exact review + one-time closure permit','Public API composition · signed caller/tenant/buyer authorization · no model/provider/PayPal secrets'])
out.append('<rect x="500" y="212" width="500" height="27" rx="6" fill="#eaf1f8" stroke="#3875a5"/>')
text(750,231,'Private Commerce database · contracts / saga / permits',14,anchor='middle')
xs=[30,395,760,1125]; names=['Provider service','Delivery service','Investigation service','Payments service']
lines=[['Attempt intent + provider task ID','Known-job lookup before regeneration','Unknown submission blocks replay'],['Private archive + media integrity','Reviewed access restoration','Actual purchaser-route receipt'],['Durable AI run + scoped reads','Literal evidence citations + abstention','Required current outcome assessment'],['Only PayPal credential owner','Atomic unit/refund reservations','Confirmed child resource + journal']]
for x,name,body in zip(xs,names,lines):
 arrow(x+172,250,x+172,315)
 box(x,315,345,160,name,body)
 arrow(x+172,475,x+172,515)
 box(x,515,345,90,name.split()[0]+' database',['Private role · tenant RLS · local outbox'],bg='#eaf1f8')
text(750,291,'Authenticated APIs + durable outbox/inbox · local transactions and persisted workflow · no shared business tables',15,anchor='middle')
box(30,655,345,120,'Runway adapter',['Generation / task lookup','Paid inference off by default'],color='#c47736',bg='#fff8ef')
box(395,655,345,120,'Isolated media worker',['Bounded bytes · decode / hash','No business keys or database'],color='#c47736',bg='#fff8ef')
box(760,655,345,120,'Gemini investigator',['Real model + bounded tool selection','No payment tools or price authority'],color='#c47736',bg='#fff8ef')
box(1125,655,345,120,'PayPal Sandbox',['Authorize → final capture OR void','Original-capture refund + read-back'],color='#c47736',bg='#fff8ef')
for x in xs:out.append(f'<path d="M{x+345} 430 H{x+354} V633 H{x+172} V652" fill="none" stroke="#65809b" stroke-width="1.6" marker-end="url(#arrow)"/>')
box(30,815,1440,110,'Required proof for normal case closure',['Current cited AI assessment + valid buyer-access evidence + exact approval + confirmed PayPal outcome','AI outage pauses new normal completion. Preservation, existing customer access and safe financial release continue.'],color='#1a8b77',bg='#edf9f4')
text(30,961,'Verified: 49 local tests · native PostgreSQL · 11 healthy containers · real Sandbox authorize / $40 capture / refund / void · real Gemini',17,'#183b59','700')
text(30,989,'Not yet: signed PayPal webhook received · real provider output in production · cloud deployment · external OIDC',15)
out.append('</svg>');(p/'architecture.svg').write_text('\n'.join(out),encoding='utf-8');print('Wrote current service diagram')
