function itemName(item) {
  return String(
    item?.name ||
    item?.server_filename ||
    item?.file_name ||
    ''
  ).trim()
}

function itemType(item) {
  if (item?.type) return item.type
  if (item?.dir || item?.isdir) return 'dir'
  return 'file'
}

export function selectMissingSyncItems(items, destinationItems, options = {}) {
  const existingNames = new Set(
    (Array.isArray(destinationItems) ? destinationItems : [])
      .map(itemName)
      .filter(Boolean)
  )
  const selected = []
  const seen = new Set()
  const sourceName = String(options.sourceName || '').trim()

  for (const item of Array.isArray(items) ? items : []) {
    const name = itemName(item)
    if (!name || seen.has(name)) continue
    seen.add(name)

    // Quark exposes the shared root folder together with its children.
    // The job already targets that folder, so transferring it again would
    // create a nested copy instead of syncing the folder contents.
    if (sourceName && name === sourceName && itemType(item) === 'dir') continue
    if (existingNames.has(name)) continue
    selected.push(item)
  }

  return selected
}
