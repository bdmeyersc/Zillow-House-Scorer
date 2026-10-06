import email, glob, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples')
from email import policy
for f in sorted(glob.glob(os.path.join(ROOT, '*.mhtml'))):
    msg = email.message_from_binary_file(open(f,'rb'), policy=policy.default)
    parts = list(msg.walk())
    html = None
    for p in parts:
        if p.get_content_type()=='text/html':
            html = p.get_content(); break
    out = os.path.join(ROOT, 'html', os.path.basename(f).split(' _ ')[0] + '.html')
    os.makedirs(os.path.join(ROOT, 'html'), exist_ok=True)
    open(out,'w').write(html)
    print(out)
