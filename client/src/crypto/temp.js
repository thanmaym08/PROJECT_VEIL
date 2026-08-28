export async function hasVault() {
  try {
    const vault = await getStore("vault");
    return !!vault;
  } catch (e) {
    return false;
  }
}
