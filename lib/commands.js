export async function processAdminCommands(text) {
  const travelMatch = text.match(/Buffer:\s*(\d+)/i);
  const saveMatch = text.match(/Save:\s*(true|false)/i);
  return { 
    travelOverride: travelMatch ? parseInt(travelMatch[1]) : null, 
    saveOverride: saveMatch ? (saveMatch[1].toLowerCase() === 'true') : false 
  };
}
