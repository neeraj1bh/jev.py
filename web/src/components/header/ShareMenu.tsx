import { Envelope, LinkedinLogo, LinkSimple, ShareNetwork, XLogo } from "@phosphor-icons/react";
import { useState } from "react";

import { Icon } from "../ui/Icon";
import { Dropdown, MenuItem } from "../ui/Menu";

// The page runs on localhost, which means nothing to anyone else, so it shares the repository.
const URL = "https://github.com/neeraj1bh/jev.py";
const TEXT =
  "jev.py: ask a language model a small question about some text and get back a probability for every answer";

const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

export function ShareMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = encodeURIComponent(URL);
  const text = encodeURIComponent(TEXT);

  return (
    <Dropdown
      open={menuOpen}
      onOpenChange={(next) => {
        setMenuOpen(next);
        if (!next) setCopied(false);
      }}
      round
      title="Share jev.py"
      button={<Icon icon={ShareNetwork} size={14} />}
      menuClassName="right-0 left-auto w-[280px] max-[860px]:right-auto max-[860px]:left-0 max-[600px]:fixed max-[600px]:inset-x-4 max-[600px]:top-16 max-[600px]:w-auto"
    >
      <MenuItem
        icon={LinkSimple}
        label="Copy link"
        detail={copied ? "Copied" : "github.com/neeraj1bh/jev.py"}
        highlightDetail={copied}
        onSelect={async () => {
          try {
            await navigator.clipboard.writeText(URL);
            setCopied(true);
          } catch {
            // No clipboard permission: the link is in the row's detail to copy by hand.
          }
        }}
      />
      <MenuItem
        icon={XLogo}
        label="Post on X"
        detail=""
        onSelect={() => open(`https://x.com/intent/post?text=${text}&url=${url}`)}
      />
      <MenuItem
        icon={LinkedinLogo}
        label="LinkedIn"
        detail=""
        onSelect={() => open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`)}
      />
      <MenuItem
        icon={Envelope}
        label="Email"
        detail=""
        onSelect={() => {
          window.location.href = `mailto:?subject=jev.py&body=${text}%0A%0A${url}`;
        }}
      />
    </Dropdown>
  );
}
