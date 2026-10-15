(function(root){
 async function allowed(sb,session){
  if(!session)return false;
  try{
   const {data,error}=await sb.auth.getUser();
   if(error || data.user?.app_metadata?.role!=='admin')return false;
   const result=await sb.rpc('is_cadde_admin');
   return !result.error && result.data===true;
  }catch{return false;}
 }
 root.CDAdmin=Object.freeze({allowed});
})(window);
